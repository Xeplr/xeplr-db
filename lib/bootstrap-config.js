// bootstrapConfigDb — creates + migrates + seeds the framework's xeplr_config
// database. This is @xeplr/db's responsibility so the control-plane DB can
// never drift or be half-built: one call materializes an identical config DB
// on any deployment.
//
// xeplr_config holds ONLY non-sensitive framework data — import metadata and
// reference data (countries/states/…). It never holds db_info or credentials;
// those are consumer-owned. Its OWN connection comes from the environment
// (the bootstrap root of trust), passed in here as `connection`.
//
//   const { bootstrapConfigDb } = require('@xeplr/db');
//   const { db } = await bootstrapConfigDb({
//     connection: { host, port, user, password },   // admin-capable
//     database: 'xeplr_config'                        // optional, default
//   });

const path = require('path');
const knexLib = require('knex');
const { migrationsFor } = require('./app-migrations');
const { resolveDirectories } = require('./directories');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'config', 'migrations');
const SEEDS_DIR      = path.join(__dirname, '..', 'config', 'seeds');

// Only allow simple identifiers as DB names — CREATE DATABASE can't be
// parameterized, so we validate rather than interpolate arbitrary input.
function assertSafeDbName(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error('Unsafe database name: "' + name + '"');
  }
  return name;
}

// CREATE DATABASE <name> if it doesn't already exist. Connects to the
// maintenance DB ('postgres') to do it.
async function ensureDatabase(connection, dbName) {
  assertSafeDbName(dbName);
  const admin = knexLib({
    client: 'pg',
    connection: Object.assign({}, connection, { database: 'postgres' }),
    pool: { min: 0, max: 1 }
  });
  try {
    const res = await admin.raw('SELECT 1 FROM pg_database WHERE datname = ?', [dbName]);
    if (res.rows.length === 0) {
      await admin.raw('CREATE DATABASE "' + dbName + '"');
      return { created: true };
    }
    return { created: false };
  } finally {
    await admin.destroy();
  }
}

async function bootstrapConfigDb(options = {}) {
  const dbName = options.database || 'xeplr_config';
  const connection = options.connection;
  if (!connection) throw new Error('bootstrapConfigDb: options.connection is required');

  const ensured = await ensureDatabase(connection, dbName);

  const db = knexLib({
    client: 'pg',
    connection: Object.assign({}, connection, { database: dbName }),
    pool: { min: 0, max: options.poolMax || 5 },
    // The library's own migrations, then an app's (XEPLR_CONFIG_MIGRATIONS, or
    // options.extDir) — 'precede', as every library. It was documented and
    // never read, so an app could not add a row to xeplr_configs at all.
    // knex migrations (.js), one ledger keyed by file name: keep app file
    // names distinct.
    migrations: {
      directory: resolveDirectories(MIGRATIONS_DIR, options.extDir !== undefined ? options.extDir : migrationsFor('config'), 'precede'),
      tableName: 'knex_migrations',
      // Each directory in turn, the library's first — not every file sorted
      // together by name, which would run an app's 0001 before our 0005.
      sortDirsSeparately: true
    },
    seeds:      { directory: SEEDS_DIR }
  });

  const [, migrations] = await db.migrate.latest();
  let seeds = [];
  if (options.seed !== false) {
    const [ran] = await db.seed.run();
    seeds = ran || [];
  }

  return { db, database: dbName, created: ensured.created, migrations, seeds };
}

module.exports = { bootstrapConfigDb, ensureDatabase };
