const { resolveConfig, getConnection, bindModels, destroyAll, destroy } = require('./lib/connection');
const BaseModel = require('./lib/BaseModel');
const { MT_ALL, configureMt, getMtConfig, runWithMt, getMtContext, mtMiddleware } = require('./lib/BaseModel');
const migrator = require('./lib/migrator');

module.exports = {
  resolveConfig,
  getConnection,
  bindModels,
  destroyAll,
  destroy,
  BaseModel,
  migrator,
  MT_ALL,
  configureMt,
  getMtConfig,
  runWithMt,
  getMtContext,
  mtMiddleware
};
