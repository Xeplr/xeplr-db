const { resolveConfig, getConnection, bindModels, destroyAll, destroy } = require('./lib/connection');
const BaseModel = require('./lib/BaseModel');
const { MT_ALL, registerMTs, getMtConfig, runWithMt, getMtContext, mtMiddleware } = require('./lib/BaseModel');
// migrator: knex-based, kept for bootstrapConfigDb's own reference-data
// migrations (config/migrations) and any other existing knex-migration
// consumer (e.g. xeplr-jobs) not part of this restructure.
const migrator = require('./lib/migrator');
// sqlMigrator: the new hand-written .sql, ledger-tracked, no-down() runner —
// use this for any new app's schema/seed migrations (see @xeplr/auth).
const sqlMigrator = require('./lib/sqlMigrator');
const { bootstrapConfigDb, ensureDatabase } = require('./lib/bootstrap-config');

module.exports = {
  resolveConfig,
  getConnection,
  bindModels,
  destroyAll,
  destroy,
  BaseModel,
  migrator,
  sqlMigrator,
  bootstrapConfigDb,
  ensureDatabase,
  MT_ALL,
  registerMTs,
  getMtConfig,
  runWithMt,
  getMtContext,
  mtMiddleware
};
