// dataDir: every file inside the folder of the tenant the work runs as, under
// XEPLR_DATA_DIR. Two companies, the same names, on a real folder.
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
// The modules themselves: the package's entry also opens connections, which
// needs @xeplr/utils (not installed in this repo on its own).
var db = Object.assign({}, require('../lib/BaseModel'), { dataDir: require('../lib/dataDir') });
db.dataRequiredEnv = db.dataDir.requiredEnv;
var dataDir = db.dataDir;

var ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xeplr-db-data-')));
var OUTSIDE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xeplr-db-outside-')));
process.env.XEPLR_DATA_DIR = ROOT;
var ACME = { mtId1: 'acme', mtId2: 'w1' };
var BETA = { mtId1: 'beta', mtId2: 'w1' };
function code(fn) { try { fn(); return null; } catch (e) { return e.code; } }

test('required, by its own name', function() {
  assert.deepStrictEqual(db.dataRequiredEnv, ['XEPLR_DATA_DIR']);
});

test('no application registered: no folder', function() {
  assert.strictEqual(code(function() { dataDir.tenantFolder(); }), 'NO_TENANT');
});

test('the root is required, absolute, and must exist — never defaulted', function() {
  db.registerApplication('xeplr-db-test');
  var saved = process.env.XEPLR_DATA_DIR;
  try {
    delete process.env.XEPLR_DATA_DIR;
    assert.strictEqual(code(function() { dataDir.root(); }), 'DATA_DIR_UNSET');
    process.env.XEPLR_DATA_DIR = 'relative';
    assert.strictEqual(code(function() { dataDir.root(); }), 'DATA_DIR_UNSET');
    process.env.XEPLR_DATA_DIR = path.join(OUTSIDE, 'missing');
    assert.strictEqual(code(function() { dataDir.root(); }), 'DATA_DIR_UNSET');
  } finally { process.env.XEPLR_DATA_DIR = saved; }
});

test('with no tenancy registered the app is one tenant: <root>/<app>', function() {
  assert.strictEqual(dataDir.tenantFolder(), path.join(ROOT, 'xeplr-db-test'));
});

test('each tenant has its own folder, and the same name is its own file', function() {
  db.registerMTs({ l1: { name: 'companyId', header: 'x-company-id' }, l2: { name: 'workspaceId', header: 'x-workspace-id' } });
  var a = db.runWithMt(ACME, function() { return dataDir.resolve('bank/sept.csv'); });
  var b = db.runWithMt(BETA, function() { return dataDir.resolve('bank/sept.csv'); });
  assert.strictEqual(a, path.join(ROOT, 'xeplr-db-test', 'acme', 'w1', 'bank', 'sept.csv'));
  assert.strictEqual(b, path.join(ROOT, 'xeplr-db-test', 'beta', 'w1', 'bank', 'sept.csv'));
  assert.strictEqual(db.runWithMt(ACME, function() { return dataDir.scratch(); }), path.join(ROOT, 'xeplr-db-test', 'acme', 'w1', 'tmp'));
  assert.strictEqual(db.runWithMt(ACME, function() { return dataDir.nameOf(a); }), path.join('bank', 'sept.csv'));
  assert.strictEqual(db.runWithMt(BETA, function() { return dataDir.nameOf(a); }), null);
});

test('one tenant never reaches another\'s: not by full path, ../, a link, or an address', function() {
  var acmeFile = db.runWithMt(ACME, function() { return dataDir.resolve('bank/sept.csv'); });
  fs.mkdirSync(path.dirname(acmeFile), { recursive: true });
  fs.writeFileSync(acmeFile, 'x');
  assert.strictEqual(db.runWithMt(BETA, function() { return code(function() { dataDir.resolve(acmeFile); }); }), 'PATH_NOT_ALLOWED');
  assert.strictEqual(db.runWithMt(BETA, function() { return code(function() { dataDir.resolve('../../acme/w1/bank/sept.csv'); }); }), 'PATH_NOT_ALLOWED');
  db.runWithMt(BETA, function() { fs.symlinkSync(path.join(ROOT, 'xeplr-db-test', 'acme'), path.join(dataDir.tenantFolder(), 'link')); });
  assert.strictEqual(db.runWithMt(BETA, function() { return code(function() { dataDir.resolve('link/w1/bank/sept.csv'); }); }), 'PATH_NOT_ALLOWED');
  assert.strictEqual(db.runWithMt(BETA, function() { return code(function() { dataDir.resolve('http://169.254.169.254/'); }); }), 'PATH_NOT_ALLOWED');
  assert.strictEqual(db.runWithMt(BETA, function() { return code(function() { dataDir.resolve(path.join(OUTSIDE, 'x')); }); }), 'PATH_NOT_ALLOWED');
  assert.strictEqual(db.runWithMt(BETA, function() { return code(function() { dataDir.resolve(''); }); }), 'PATH_NOT_ALLOWED');
});

test('* is _all; a missing level, or an id that could climb, has no folder', function() {
  assert.strictEqual(db.runWithMt({ mtId1: '*', mtId2: '*' }, function() { return dataDir.tenantFolder(); }), path.join(ROOT, 'xeplr-db-test', '_all', '_all'));
  assert.strictEqual(code(function() { dataDir.tenantFolder(); }), 'NO_TENANT');
  assert.strictEqual(db.runWithMt({ mtId1: 'acme' }, function() { return code(function() { dataDir.tenantFolder(); }); }), 'NO_TENANT');
  assert.strictEqual(db.runWithMt({ mtId1: '..', mtId2: 'w1' }, function() { return code(function() { dataDir.tenantFolder(); }); }), 'NO_TENANT');
  assert.strictEqual(db.runWithMt({ mtId1: 'a/b', mtId2: 'w1' }, function() { return code(function() { dataDir.tenantFolder(); }); }), 'NO_TENANT');
});

test.after(function() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.rmSync(OUTSIDE, { recursive: true, force: true });
});
