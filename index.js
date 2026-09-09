const { resolveConfig, getConnection, bindModels, destroyAll, destroy, ensureDatabaseFor } = require('./lib/connection');
const BaseModel = require('./lib/BaseModel');
const { MT_ALL, registerMTs, getMtConfig, runWithMt, getMtContext, mtMiddleware } = require('./lib/BaseModel');
// Application scope — a second axis, independent of the mt* tenancy above.
// See the long comment at the top of lib/BaseModel.js for why they are not
// the same thing and why this one never comes from a request header.
const { APP_ALL, registerApplication, getApplicationId } = require('./lib/BaseModel');
const { addApplicationIdColumns, assertApplicationIdColumns } = require('./lib/application-column');
// The one convention for adding migrations to a library from outside it:
// XEPLR_<APP>_MIGRATIONS, identical in every library. See the file.
const { migrationsFor, migrationsVar } = require('./lib/app-migrations');
// migrator: knex-based, kept for bootstrapConfigDb's own reference-data
// migrations (config/migrations) and any other existing knex-migration
// consumer (e.g. xeplr-jobs) not part of this restructure.
const migrator = require('./lib/migrator');
// sqlMigrator: the new hand-written .sql, ledger-tracked, no-down() runner —
// use this for any new app's schema/seed migrations (see @xeplr/auth).
const sqlMigrator = require('./lib/sqlMigrator');
const { bootstrapConfigDb, ensureDatabase } = require('./lib/bootstrap-config');
// One shared XEPLR_DB_CONNECTION, with a per-service override — see the file.
const { resolveDbConnection, describeDbConnection } = require('./lib/resolve-connection');

module.exports = {
  resolveConfig,
  getConnection,
  bindModels,
  destroyAll,
  destroy,
  ensureDatabaseFor,
  BaseModel,
  migrator,
  sqlMigrator,
  bootstrapConfigDb,
  ensureDatabase,
  resolveDbConnection,
  describeDbConnection,
  MT_ALL,
  APP_ALL,
  registerApplication,
  getApplicationId,
  addApplicationIdColumns,
  assertApplicationIdColumns,
  migrationsFor,
  migrationsVar,
  registerMTs,
  getMtConfig,
  runWithMt,
  getMtContext,
  mtMiddleware
};
