const knex = require('knex');
const { Model } = require('objection');
const { decrypt } = require('@xeplr/utils/isomorphic/crypto');

const connections = {};
var _resolvedConfigs = {};
var _sourceCache = {};        // decrypted-config cache keyed by the encrypted string (decrypt each blob once)

/**
 * Register a connection under `name`, so getConnection()/the migrator can use
 * it by that name later. The APP supplies the connection — the framework never
 * forces a `<NAME>_CONNECTION` env var.
 *
 * `source` is what the app hands in, one of:
 *   - an encrypted connection string  → decrypted with ENCRYPTION_KEY
 *   - a decrypted config object { host, port, user, password }
 *   - omitted → LEGACY fallback: reads the `<NAME>_CONNECTION` env var
 *     (kept only for backward compatibility; prefer supplying it explicitly)
 *
 * @param {string} name
 * @param {string|object} [source] - the app-supplied connection (see above)
 * @returns {Promise<object>} the resolved { host, port, user, password }
 */
// Turn an app-supplied "db info" into a plain { host, port, user, password }
// config: a decrypted object is used as-is; an encrypted string is decrypted
// with ENCRYPTION_KEY; anything else → null.
async function resolveSource(source) {
  if (source && typeof source === 'object') return source;
  if (typeof source === 'string' && source) {
    if (_sourceCache[source]) return _sourceCache[source];   // same blob → decrypt once
    var encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) throw new Error('ENCRYPTION_KEY is required to decrypt a connection string');
    var config = JSON.parse(await decrypt(source, encryptionKey));
    _sourceCache[source] = config;
    return config;
  }
  return null;
}

async function resolveConfig(name, source) {
  var key = (name || '').toUpperCase();
  if (_resolvedConfigs[key]) return _resolvedConfigs[key];

  var config = await resolveSource(source) || await resolveSource(process.env[key + '_CONNECTION']);



  if (!config) {
    throw new Error('resolveConfig("' + name + '"): no connection supplied. Pass the app\'s ' +
      'connection string/config, or set ' + key + '_CONNECTION.');
  }

  _resolvedConfigs[key] = config;
  return config;
}

/**
 * Get (or create + cache) a knex connection AND wire the models to it — one call,
 * no separate resolveConfig/bindModels needed.
 *
 *   var db = await getConnection('mydb', process.env.MY_CONNECTION);   // that's it
 *
 * @param {string} dbName   Database name (the connection carries only the server login)
 * @param {string|object} [dbInfo]  Encrypted connection string, or a decrypted
 *                          { host, port, user, password } config. Omit only if a
 *                          prior resolveConfig(options.connectionName) supplied it.
 * @param {object} [options]
 * @param {string}  [options.connectionName]  Fall back to a previously-resolved config by name
 * @param {boolean} [options.bind=true]  Bind these as the Objection model knex. Set false for
 *                          a SECONDARY connection (e.g. cross-DB reads) that must not become global.
 * @param {string}  [options.client='pg']
 * @param {object}  [options.pool]  { min, max }
 * @returns {Promise<import('knex').Knex>}
 */
var _connectionBind = {};   // dbName -> the bind:true/false a prior getConnection() call actually used

async function getConnection(dbName, dbInfo, options = {}) {
  if (connections[dbName]) {
    // The cache short-circuits before `options` is even consulted, so a
    // second call for the same dbName with a DIFFERENT bind value is
    // silently ignored rather than rebinding (or erroring) — warn instead of
    // leaving that as a silent trap for whoever adds the second caller.
    var requestedBind = options.bind !== false;
    if (requestedBind !== _connectionBind[dbName]) {
      console.warn('[@xeplr/db] getConnection("' + dbName + '"): requested bind:' + requestedBind +
        ' but the cached connection was opened with bind:' + _connectionBind[dbName] + ' — ignoring, reusing the cached connection as-is.');
    }
    return connections[dbName];
  }

  // Legacy call shape: getConnection(dbName, { connectionName, pool, ... }). An
  // object with no server-login fields is options, not a connection config.
  if (dbInfo && typeof dbInfo === 'object' && !dbInfo.host && !dbInfo.user && !dbInfo.password) {
    options = dbInfo;
    dbInfo = undefined;
  }

  var config = await resolveSource(dbInfo);
  if (!config && options.connectionName) config = getResolvedConfig(options.connectionName);
  if (!config) {
    throw new Error('getConnection("' + dbName + '"): pass the encrypted db info (or a ' +
      '{ host, user, password } config), or resolveConfig(connectionName) first.');
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
    pool: { min: poolConfig.min || 2, max: poolConfig.max || 10 }
  });

  connections[dbName] = db;
  _connectionBind[dbName] = options.bind !== false;
  if (options.bind !== false) bindModels(db);   // models are wired automatically
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
