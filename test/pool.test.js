// The pool a connection keeps (lib/pool.js): an app keeps two idle; a file run
// by `node --test` keeps none and lets one go after a second, so many test
// files at once do not fill Postgres with idle connections. A min the caller
// gives is kept, 0 included.
var test = require('node:test');
var assert = require('node:assert');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

var POOL = path.join(__dirname, '..', 'lib', 'pool.js');

/** poolOf(given) in a process that is, or is not, a node --test file. */
function poolIn(testRun, given) {
  var env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  if (testRun) env.NODE_TEST_CONTEXT = 'child-v8';
  var out = execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify(require(' + JSON.stringify(POOL) + ').poolOf(' + JSON.stringify(given) + ')))'], { env: env });
  return JSON.parse(String(out));
}

test('an app keeps two connections idle, up to ten', function () {
  assert.deepStrictEqual(poolIn(false, {}), { min: 2, max: 10 });
});

test('a test file keeps none idle, and lets one go after a second', function () {
  assert.deepStrictEqual(poolIn(true, {}), { min: 0, max: 10, idleTimeoutMillis: 1000 });
});

test('a min the caller gives is kept, 0 included (it was read as "none given")', function () {
  assert.deepStrictEqual(poolIn(false, { min: 0, max: 3 }), { min: 0, max: 3 });
  assert.deepStrictEqual(poolIn(true, { min: 1 }), { min: 1, max: 10, idleTimeoutMillis: 1000 });
});

test('this file itself runs under node --test, so its own pools keep nothing idle', function () {
  var pool = require('../lib/pool');
  if (process.env.NODE_TEST_CONTEXT) assert.strictEqual(pool.poolOf({}).min, 0);
  assert.strictEqual(pool.poolOf(null).max, 10);
});
