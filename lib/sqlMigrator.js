const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Client } = require('pg');
const { getResolvedConfig } = require('./connection');
const { resolveDirectories } = require('./migrator');

/**
 * Hand-written .sql migrations, no up/down. Each file is applied exactly once
 * (tracked in a ledger table by filename) inside its own transaction. Base +
 * extension directories share one ledger, same precede/succeed/override
 * layering as the knex-based migrator (see resolveDirectories in ./migrator).
 *
 * Executed via a plain `pg` client (not knex's query builder) specifically so
 * migration SQL is never scanned for `?` placeholders — a literal `?` (jsonb
 * operators, regexes, etc.) in a migration file must not be misread as a bind
 * parameter.
 */

function buildConnectionInfo(options) {
  if (!options.db) throw new Error('Database name is required (options.db)');
  var connName = (options.connectionName || '').toUpperCase();
  var resolved = getResolvedConfig(connName);
  if (!resolved) {
    throw new Error('No resolved config for "' + connName + '". Call resolveConfig("' + connName + '") first.');
  }
  return {
    host: resolved.host,
    port: resolved.port,
    user: resolved.user,
    password: resolved.password,
    database: options.db
  };
}

async function withClient(options, fn) {
  var client = new Client(buildConnectionInfo(options));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function ensureLedger(client, tableName) {
  await client.query(
    'CREATE TABLE IF NOT EXISTS "' + tableName + '" (' +
    'filename text PRIMARY KEY, checksum text NOT NULL, "appliedAt" timestamptz NOT NULL DEFAULT now())'
  );
}

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ${VAR_NAME} → process.env.VAR_NAME, substituted before execution. Throws
// (fails loud) rather than silently inserting "undefined" into applied SQL.
function substituteEnv(sql, filename) {
  return sql.replace(/\$\{([A-Z0-9_]+)\}/g, function(match, name) {
    if (process.env[name] === undefined) {
      throw new Error('Migration ' + filename + ' references ${' + name + '} but env var ' + name + ' is not set');
    }
    return process.env[name];
  });
}

function listSqlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(function(f) { return f.endsWith('.sql'); }).sort();
}

function getNextNumber(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  var files = listSqlFiles(dir);
  if (files.length === 0) return '0001';
  var last = files[files.length - 1];
  var n = parseInt(last.split('_')[0], 10);
  return String(n + 1).padStart(4, '0');
}

/**
 * Create a new (empty) migration file.
 * @param {string} name
 * @param {object} [options] - { dir }
 * @returns {string} path to the created file
 */
function create(name, options = {}) {
  if (!name) throw new Error('Migration name is required');
  var dir = path.resolve(options.dir || './migrations');
  var number = getNextNumber(dir);
  var filename = number + '_' + name + '.sql';
  var filepath = path.join(dir, filename);
  fs.writeFileSync(
    filepath,
    '-- ' + filename + '\n' +
    '-- Hand-written, applied once, no down(). Reference env vars as ${VAR_NAME}.\n\n'
  );
  return filepath;
}

/**
 * Run pending .sql migrations.
 * @param {object} options
 * @param {string} options.db
 * @param {string} [options.dir]
 * @param {string} [options.extDir]
 * @param {string} [options.type='precede']
 * @param {string} [options.tableName='xeplr_migrations']
 * @returns {Promise<{migrations: string[]}>}
 */
async function up(options = {}) {
  var tableName = options.tableName || 'xeplr_migrations';
  var dirs = resolveDirectories(options.dir || './migrations', options.extDir, options.type || 'precede');

  return withClient(options, async function(client) {
    await ensureLedger(client, tableName);
    var appliedRows = (await client.query('SELECT filename FROM "' + tableName + '"')).rows;
    var applied = new Set(appliedRows.map(function(r) { return r.filename; }));

    var ran = [];
    for (var i = 0; i < dirs.length; i++) {
      var files = listSqlFiles(dirs[i]);
      for (var j = 0; j < files.length; j++) {
        var filename = files[j];
        if (applied.has(filename)) continue;

        var raw = fs.readFileSync(path.join(dirs[i], filename), 'utf8');
        var sum = checksum(raw);
        var sql = substituteEnv(raw, filename);

        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO "' + tableName + '" (filename, checksum) VALUES ($1, $2)', [filename, sum]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error('Migration ' + filename + ' failed: ' + err.message);
        }
        applied.add(filename);
        ran.push(filename);
      }
    }
    return { migrations: ran };
  });
}

/**
 * Migration status: completed / pending / drifted (an applied file whose
 * on-disk content no longer matches the checksum recorded at apply-time —
 * i.e. someone edited an already-applied migration).
 */
async function status(options = {}) {
  var tableName = options.tableName || 'xeplr_migrations';
  var dirs = resolveDirectories(options.dir || './migrations', options.extDir, options.type || 'precede');

  return withClient(options, async function(client) {
    await ensureLedger(client, tableName);
    var rows = (await client.query('SELECT filename, checksum FROM "' + tableName + '"')).rows;
    var appliedMap = {};
    rows.forEach(function(r) { appliedMap[r.filename] = r.checksum; });

    var completed = [];
    var pending = [];
    var drift = [];
    for (var i = 0; i < dirs.length; i++) {
      var files = listSqlFiles(dirs[i]);
      for (var j = 0; j < files.length; j++) {
        var filename = files[j];
        if (Object.prototype.hasOwnProperty.call(appliedMap, filename)) {
          completed.push(filename);
          var raw = fs.readFileSync(path.join(dirs[i], filename), 'utf8');
          if (checksum(raw) !== appliedMap[filename]) drift.push(filename);
        } else {
          pending.push(filename);
        }
      }
    }
    return { completed, pending, drift };
  });
}

module.exports = { up, status, create };
