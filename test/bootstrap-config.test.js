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
  password: process.env.PG_PASSWORD || 'postgres'
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

test('the standard units are seeded for every app and company, with exact factors', async function () {
  var r = await bootstrapConfigDb({ connection: CONN, database: DB });
  try {
    var t = await r.db('units').where({ code: 't' }).first();
    assert.strictEqual(t.kind, 'weight');
    assert.strictEqual(Number(t.factor), 1000, 'a metric ton is 1000 of the weight base (kg)');
    assert.strictEqual([t.applicationId, t.mtId1, t.mtId2].join(), '*,*,*');
    var lb = await r.db('units').where({ code: 'lb' }).first();
    assert.strictEqual(String(lb.factor).replace(/0+$/, ''), '0.45359237', 'a pound exactly, not a float');
    var kinds = (await r.db('units').distinct('kind')).map(function (k) { return k.kind; }).sort();
    assert.deepStrictEqual(kinds, ['area', 'energy', 'length', 'time', 'volume', 'weight']);
    // Every kind has exactly one base unit, factor 1.
    var bases = await r.db('units').where({ factor: 1 }).select('kind');
    assert.strictEqual(bases.length, kinds.length);
  } finally {
    await r.db.destroy();
  }
});

test('an app adds its own migrations with XEPLR_CONFIG_MIGRATIONS — after the library\'s, e.g. a company\'s own unit', async function () {
  var fs = require('fs'), os = require('os'), path = require('path');
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xcfg-app-'));
  // Named 0001 on purpose: it must still run AFTER the library's 0006 (units).
  fs.writeFileSync(path.join(dir, '0001_testapp_bag.js'),
    "exports.up = function (knex) { return knex('units').insert({ id: 'u_testapp_bag', code: 'bag', kind: 'weight', label: 'Bag', symbol: 'bag', factor: 50, applicationId: 'testapp', mtId1: 'c1' }); };\n" +
    "exports.down = function (knex) { return knex('units').where({ id: 'u_testapp_bag' }).delete(); };\n");
  var before = process.env.XEPLR_CONFIG_MIGRATIONS;
  process.env.XEPLR_CONFIG_MIGRATIONS = dir;
  var r;
  try {
    r = await bootstrapConfigDb({ connection: CONN, database: DB });
    var bag = await r.db('units').where({ code: 'bag' }).first();
    assert.ok(bag && bag.applicationId === 'testapp' && Number(bag.factor) === 50, 'the app\'s row is there');
    assert.ok(r.migrations.indexOf('0001_testapp_bag.js') !== -1, 'run as a migration of its own');
  } finally {
    if (before === undefined) delete process.env.XEPLR_CONFIG_MIGRATIONS; else process.env.XEPLR_CONFIG_MIGRATIONS = before;
    if (r) await r.db.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a XEPLR_CONFIG_MIGRATIONS directory that does not exist is an error, not silence', async function () {
  await assert.rejects(bootstrapConfigDb({ connection: CONN, database: DB, extDir: '/nope/not/here' }), /does not exist/);
});
