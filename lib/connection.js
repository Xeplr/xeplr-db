const knex = require('knex');
const { Model } = require('objection');
const { decrypt } = require('@xeplr/utils/isomorphic/crypto');

const connections = {};
var _resolvedConfigs = {};

/**
 * Resolve connection config for a specific service/connection name.
 * Decrypts <NAME>_CONNECTION env var using ENCRYPTION_KEY.
 *
 * @param {string} name - Connection name (e.g. 'api', 'auth', 'jobs')
 * @returns {Promise<object>} Resolved { host, port, user, password }
 */
async function resolveConfig(name) {
  var key = (name || '').toUpperCase();
  if (_resolvedConfigs[key]) return _resolvedConfigs[key];

  var encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY env var is required');
  }

  var envKey = key + '_CONNECTION';
  var encrypted = process.env[envKey];
  if (!encrypted) {
    throw new Error(envKey + ' env var is required');
  }

  var decrypted = await decrypt(encrypted, encryptionKey);
  _resolvedConfigs[key] = JSON.parse(decrypted);
  return _resolvedConfigs[key];
}

/**
 * Get or create a knex connection for a given database name.
 * resolveConfig(name) must be called first.
 *
 * @param {string} dbName - Database name
 * @param {object} [options]
 * @param {string} options.connectionName - Name used in resolveConfig (e.g. 'api', 'auth')
 * @param {string} [options.client='pg'] - Knex client
 * @param {object} [options.pool] - Pool config { min, max }
 */
function getConnection(dbName, options = {}) {
  if (connections[dbName]) {
    return connections[dbName];
  }

  var connName = (options.connectionName || '').toUpperCase();
  var config = _resolvedConfigs[connName];
  if (!config) {
    throw new Error('No resolved config for "' + connName + '". Call resolveConfig("' + connName + '") first.');
  }

  var poolConfig = options.pool || {};

  var db = knex({
    client: options.client || 'pg',
    connection: {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: dbName
    },
    pool: {
      min: poolConfig.min || 2,
      max: poolConfig.max || 10
    }
  });

  connections[dbName] = db;
  return db;
}

/**
 * Bind Objection Model to a specific knex instance.
 */
function bindModels(knexInstance) {
  Model.knex(knexInstance);
  return knexInstance;
}

/**
 * Destroy all cached connections (for graceful shutdown).
 */
async function destroyAll() {
  for (const [name, db] of Object.entries(connections)) {
    await db.destroy();
    delete connections[name];
  }
}

/**
 * Destroy a specific connection by database name.
 */
async function destroy(dbName) {
  if (connections[dbName]) {
    await connections[dbName].destroy();
    delete connections[dbName];
  }
}

function getResolvedConfig(name) {
  return _resolvedConfigs[(name || '').toUpperCase()] || null;
}

module.exports = { resolveConfig, getResolvedConfig, getConnection, bindModels, destroyAll, destroy };
