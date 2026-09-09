// applicationId column plumbing for SHARED databases — the control plane
// (xeplr_configs) and any product whose tables more than one app writes to
// (@xeplr-workflow/api). A single-app database never comes near this file:
// xeplr_bi, xeplr_erp and the auth DBs are isolated by BEING their own
// database, and a column holding one constant value in every row would be
// migration and index cost for no boundary. See BaseModel.applicationScoped.
//
// Two functions, deliberately separate:
//
//   addApplicationIdColumns()    DDL. Called from a migration, once.
//   assertApplicationIdColumns() read-only check. Called at boot, every time.
//
// The assertion exists because the column is only half the mechanism — a
// table added later, by a migration written by someone who did not know this
// rule, gets no column, and BaseModel's filter would then fail at the first
// query against it with a confusing "column does not exist". Better to fail
// at startup, naming the tables, than at 3am on one endpoint.

var APP_ALL = '*';

// Ledgers belong to the migration runners, not to any application. Adding a
// column to them would be filtered against on every migration check and
// break both runners.
var LEDGER_TABLES = ['xeplr_migrations', 'knex_migrations', 'knex_migrations_lock'];

// knex or pg-client, one interface. The config DB is bootstrapped with knex
// (bootstrapConfigDb) while the .sql migrations run on a raw pg Client, and
// this helper has to work from either.
function makeRunner(db) {
  if (typeof db === 'function' && db.raw) {
    return function(sql, params) { return db.raw(sql, params || []); };
  }
  if (db && typeof db.query === 'function') {
    return async function(sql, params) { return db.query(sql, params || []); };
  }
  throw new Error('application-column: expected a knex instance or a pg Client');
}

function rowsOf(result) {
  if (!result) return [];
  return result.rows || result[0] || result || [];
}

async function listTables(run, exclude) {
  var res = await run(
    "SELECT table_name FROM information_schema.tables " +
    "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
  return rowsOf(res)
    .map(function(r) { return r.table_name; })
    .filter(function(t) { return LEDGER_TABLES.indexOf(t) === -1 && exclude.indexOf(t) === -1; })
    .sort();
}

async function tablesMissingColumn(run, exclude) {
  var tables = await listTables(run, exclude);
  var res = await run(
    "SELECT table_name FROM information_schema.columns " +
    "WHERE table_schema = 'public' AND column_name = 'applicationId'");
  var have = rowsOf(res).map(function(r) { return r.table_name; });
  return tables.filter(function(t) { return have.indexOf(t) === -1; });
}

/**
 * Add `applicationId` to every table in the CURRENT database that lacks it,
 * backfill it, and index it. Idempotent — safe to re-run, and safe to ship in
 * a migration that may be applied to a database at any stage of its life.
 *
 *   var { addApplicationIdColumns } = require('@xeplr/db');
 *   await addApplicationIdColumns(knex, { applicationId: 'xeplr-workflow' });
 *
 * @param {object} db - knex instance or connected pg Client
 * @param {object} options
 * @param {string} options.applicationId - value to BACKFILL existing rows
 *   with. Every row already in the table was written by some app before this
 *   column existed; this names which one. Pass '*' for a table of reference
 *   data every app reads.
 * @param {string[]} [options.sharedTables=[]] - tables whose EXISTING rows
 *   are reference data readable by everyone, backfilled with '*' instead of
 *   options.applicationId (countries, states).
 * @param {string[]} [options.exclude=[]] - tables to skip entirely.
 * @returns {Promise<{ altered: string[], skipped: string[] }>}
 */
async function addApplicationIdColumns(db, options) {
  options = options || {};
  var applicationId = options.applicationId;
  if (!applicationId) {
    throw new Error('addApplicationIdColumns: options.applicationId is required — it is the value existing rows are backfilled with');
  }
  var sharedTables = options.sharedTables || [];
  var exclude = options.exclude || [];
  var run = makeRunner(db);

  var missing = await tablesMissingColumn(run, exclude);
  var all = await listTables(run, exclude);
  var altered = [];

  for (var i = 0; i < missing.length; i++) {
    var table = missing[i];
    var backfill = sharedTables.indexOf(table) === -1 ? applicationId : APP_ALL;

    // DEFAULT then NOT NULL, in one statement: the default backfills every
    // existing row in place (Postgres 11+ does this without a table rewrite)
    // and NOT NULL is the half that makes the column mandatory rather than
    // merely present.
    await run('ALTER TABLE "' + table + '" ADD COLUMN "applicationId" varchar(100) NOT NULL DEFAULT \'' + backfill + '\'');
    await run('CREATE INDEX IF NOT EXISTS "' + table + '_applicationId_index" ON "' + table + '" ("applicationId")');

    // For an APP-OWNED table the default has now done its only job. Keeping
    // it would make every future INSERT that forgets applicationId succeed
    // and silently attribute the row to whichever app happened to run this
    // migration — the exact mislabelling this column exists to prevent. Drop
    // it and let such an insert fail on NOT NULL instead.
    //
    // A SHARED table keeps its '*' default on purpose: its rows are reference
    // data, and the seeds that load them (countries, states) neither know nor
    // should know about applications.
    if (sharedTables.indexOf(table) === -1) {
      await run('ALTER TABLE "' + table + '" ALTER COLUMN "applicationId" DROP DEFAULT');
    }
    altered.push(table);
  }

  return {
    altered: altered,
    skipped: all.filter(function(t) { return altered.indexOf(t) === -1; })
  };
}

/**
 * Throw if any table in the current database is missing `applicationId`.
 * Call at startup for a SHARED database, right after migrations.
 *
 *   await assertApplicationIdColumns(knex, { database: 'xeplr_configs' });
 *
 * @param {object} db - knex instance or connected pg Client
 * @param {object} [options]
 * @param {string} [options.database] - name, for the error message only
 * @param {string[]} [options.exclude=[]]
 */
async function assertApplicationIdColumns(db, options) {
  options = options || {};
  var run = makeRunner(db);
  var missing = await tablesMissingColumn(run, options.exclude || []);
  if (missing.length) {
    throw new Error(
      'applicationId is missing from ' + missing.length + ' table(s) in ' +
      (options.database || 'this shared database') + ': ' + missing.join(', ') + '. ' +
      'Every table in a shared database must carry it — add it in a migration ' +
      'via addApplicationIdColumns(), or exclude the table explicitly if it is ' +
      'genuinely not application-owned.');
  }
  return { ok: true };
}

module.exports = {
  APP_ALL: APP_ALL,
  LEDGER_TABLES: LEDGER_TABLES,
  addApplicationIdColumns: addApplicationIdColumns,
  assertApplicationIdColumns: assertApplicationIdColumns
};
