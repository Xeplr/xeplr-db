// Integration test for bootstrapConfigDb — creates/migrates/seeds xeplr_config
// against a live Postgres. Overridable via env; defaults to the local dev box.
// Run:  node --test test/bootstrap-config.test.js

var test = require('node:test');
var assert = require('node:assert');
var knexLib = require('knex');
var { bootstrapConfigDb } = require('../lib/bootstrap-config');

var CONN = {
  host:     process.env.PG_HOST     || 'localhost',
  port:     +(process.env.PG_PORT   || 5435),
  user:     process.env.PG_USER     || 'postgres',
  password: process.env.PG_PASSWORD || 'l@rocal!Z2t9'
};
var DB = 'xeplr_config_test';

async function dropDb() {
  var admin = knexLib({ client: 'pg', connection: Object.assign({}, CONN, { database: 'postgres' }), pool: { min: 0, max: 1 } });
  try { await admin.raw('DROP DATABASE IF EXISTS ' + DB); } finally { await admin.destroy(); }
}

test.before(dropDb);
test.after(dropDb);

test('bootstrap: creates the DB, runs all migrations, seeds reference data', async function () {
  var r = await bootstrapConfigDb({ connection: CONN, database: DB });
  try {
    assert.strictEqual(r.created, true);
    // EVERY migration in config/migrations ran — counted from the directory
    // rather than written as a literal. The literal was 3 and the directory
    // had grown to 5; a test that has to be edited each time a migration is
    // added ends up asserting how many there used to be.
    var expected = require('fs')
      .readdirSync(require('path').join(__dirname, '..', 'config', 'migrations'))
      .filter(function (f) { return f.endsWith('.js'); }).length;
    assert.strictEqual(r.migrations.length, expected);

    var countries = await r.db('countries').count('* as c');
    var states    = await r.db('states').count('* as c');
    var meta       = await r.db('import_meta').count('* as c');
    assert.ok(Number(countries[0].c) >= 60, 'expected a broad countries set');
    assert.strictEqual(Number(states[0].c), 87);   // 36 IN (28 states + 8 UT) + 51 US (50 + DC)
    assert.strictEqual(Number(meta[0].c), 0);       // no fake rows seeded

    // FK + join integrity
    var row = await r.db('states').join('countries', 'states.country_id', 'countries.id')
      .select('countries.name as country').where('states.id', 'IN-MH').first();
    assert.strictEqual(row.country, 'India');
  } finally {
    await r.db.destroy();
  }
});

test('bootstrap is idempotent — second run adds nothing, no duplicates', async function () {
  var r = await bootstrapConfigDb({ connection: CONN, database: DB });
  try {
    assert.strictEqual(r.created, false);          // DB already exists
    assert.strictEqual(r.migrations.length, 0);    // nothing pending

    var countries = await r.db('countries').count('* as c');
    assert.ok(Number(countries[0].c) >= 60);       // unchanged, upsert didn't duplicate
  } finally {
    await r.db.destroy();
  }
});

test('reference data has stable ISO natural keys', async function () {
  var r = await bootstrapConfigDb({ connection: CONN, database: DB });
  try {
    var india = await r.db('countries').where({ id: 'IN' }).first();
    assert.strictEqual(india.iso3, 'IND');
    assert.strictEqual(india.currency, 'INR');
    var ca = await r.db('states').where({ id: 'US-CA' }).first();
    assert.strictEqual(ca.country_id, 'US');
    assert.strictEqual(ca.name, 'California');
  } finally {
    await r.db.destroy();
  }
});
