const path = require('path');
const fs = require('fs');
const knex = require('knex');
const { getResolvedConfig } = require('./connection');

/**
 * Build a knex config from simple options.
 * Uses resolved encrypted config if available (via resolveConfig(name)).
 * No env var fallbacks — config must come through options or resolveConfig.
 */
function buildKnexConfig(options = {}) {
  var dbName = options.db;
  if (!dbName) {
    throw new Error('Database name is required (options.db)');
  }

  var connName = (options.connectionName || '').toUpperCase();
  var resolved = getResolvedConfig(connName);
  if (!resolved) {
    throw new Error('No resolved config for "' + connName + '". Call resolveConfig("' + connName + '") first.');
  }

  return {
    client: options.client || 'pg',
    connection: {
      host: resolved.host,
      port: resolved.port,
      user: resolved.user,
      password: resolved.password,
      database: dbName
    },
    migrations: {
      directory: path.resolve(options.dir || './migrations'),
      tableName: options.tableName || 'knex_migrations',
      // base + extension migrations share one ledger on the same DB (run as
      // separate dirs). Without this, knex flags the base entries as "missing"
      // when it runs the extension dir. We deliberately allow the split source.
      disableMigrationsListValidation: true
    },
    seeds: {
      directory: path.resolve(options.seedsDir || './seeds')
    }
  };
}

/**
 * Get the next migration file number (0001, 0002, ...).
 */
function getNextNumber(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.js'))
    .sort();

  if (files.length === 0) return '0001';

  const lastFile = files[files.length - 1];
  const lastNumber = parseInt(lastFile.split('_')[0], 10);
  return String(lastNumber + 1).padStart(4, '0');
}

/**
 * Create a new migration file.
 * @param {string} name - Migration name (used as table name in template)
 * @param {object} options - { dir }
 * @returns {string} Path to created file
 */
function create(name, options = {}) {
  if (!name) throw new Error('Migration name is required');

  const dir = path.resolve(options.dir || './migrations');
  const number = getNextNumber(dir);
  const filename = `${number}_${name}.js`;
  const filepath = path.join(dir, filename);

  const template = `exports.up = function(knex) {
  return knex.schema.createTable('${name}', function(table) {
    table.string('id', 25).primary();
    table.string('mtId1', 25);
    table.string('mtId2', 25);
    table.string('mtId3', 25);
    table.string('mtId4', 25);
    table.timestamp('recordCreatedDate');
    table.timestamp('recordModifiedDate');
    table.string('recordCreatedBy', 25);
    table.string('recordModifiedBy', 25);
    table.boolean('isActive').defaultTo(true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('${name}');
};
`;

  fs.writeFileSync(filepath, template);
  return filepath;
}

/**
 * Resolve ordered directories based on type.
 *
 * @param {string} ownDir - The library's own directory
 * @param {string} extDir - The external (project) directory
 * @param {string} type   - 'precede' | 'override' | 'succeed'
 * @returns {string[]} Ordered array of directories to run
 */
function resolveDirectories(ownDir, extDir, type) {
  if (!extDir) return [ownDir];

  switch (type) {
    case 'override':
      return [path.resolve(extDir)];
    case 'succeed':
      return [path.resolve(extDir), path.resolve(ownDir)];
    case 'precede':
    default:
      return [path.resolve(ownDir), path.resolve(extDir)];
  }
}

/**
 * Run pending migrations.
 *
 * @param {object} options
 * @param {string} options.db         - Database name
 * @param {string} [options.dir]      - Library's own migrations directory
 * @param {string} [options.extDir]   - Project's additional migrations directory
 * @param {string} [options.type='precede'] - 'precede' | 'override' | 'succeed'
 * @returns {{ batch: number, migrations: string[] }}
 */
async function up(options = {}) {
  var dirs = resolveDirectories(
    options.dir || './migrations',
    options.extDir,
    options.type || 'precede'
  );

  var allMigrations = [];

  for (var i = 0; i < dirs.length; i++) {
    var cfg = buildKnexConfig(Object.assign({}, options, { dir: dirs[i] }));
    var db = knex(cfg);
    try {
      var [batch, migrations] = await db.migrate.latest();
      allMigrations = allMigrations.concat(migrations);
    } finally {
      await db.destroy();
    }
  }

  return { migrations: allMigrations };
}

/**
 * Rollback last batch of migrations.
 * @param {object} options - { db, dir, host, user, password, client, port }
 * @returns {{ batch: number, migrations: string[] }}
 */
async function rollback(options = {}) {
  const cfg = buildKnexConfig(options);
  const db = knex(cfg);
  try {
    const [batch, migrations] = await db.migrate.rollback();
    return { batch, migrations };
  } finally {
    await db.destroy();
  }
}

/**
 * Get migration status.
 * @param {object} options - { db, dir, host, user, password, client, port }
 * @returns {{ completed: string[], pending: string[] }}
 */
async function status(options = {}) {
  const cfg = buildKnexConfig(options);
  const db = knex(cfg);
  try {
    const [completed, pending] = await db.migrate.list();
    return {
      completed,
      pending: pending.map(m => m.file || m)
    };
  } finally {
    await db.destroy();
  }
}

/**
 * Create a new seed file.
 * @param {string} name - Seed name
 * @param {object} options - { seedsDir }
 * @returns {string} Path to created file
 */
function createSeed(name, options = {}) {
  if (!name) throw new Error('Seed name is required');

  const dir = path.resolve(options.seedsDir || process.env.DB_SEEDS_DIR || './seeds');
  const number = getNextNumber(dir);
  const filename = `${number}_${name}.js`;
  const filepath = path.join(dir, filename);

  const template = `exports.seed = async function(knex) {
  await knex('${name}').del();
  await knex('${name}').insert([
    // { id: '1', ... }
  ]);
};
`;

  fs.writeFileSync(filepath, template);
  return filepath;
}

/**
 * Run seed files.
 *
 * @param {object} options
 * @param {string} options.db            - Database name
 * @param {string} [options.seedsDir]    - Library's own seeds directory
 * @param {string} [options.extSeedsDir] - Project's additional seeds directory
 * @param {string} [options.type='precede'] - 'precede' | 'override' | 'succeed'
 * @returns {string[]} List of seed files run
 */
async function seed(options = {}) {
  var dirs = resolveDirectories(
    options.seedsDir || './seeds',
    options.extSeedsDir,
    options.type || 'precede'
  );

  var allResults = [];

  for (var i = 0; i < dirs.length; i++) {
    if (!fs.existsSync(dirs[i])) continue;

    var cfg = buildKnexConfig(Object.assign({}, options, { seedsDir: dirs[i] }));
    var db = knex(cfg);
    try {
      var [result] = await db.seed.run();
      allResults = allResults.concat(result || []);
    } finally {
      await db.destroy();
    }
  }

  return allResults;
}

module.exports = { buildKnexConfig, create, up, rollback, status, createSeed, seed, resolveDirectories };
