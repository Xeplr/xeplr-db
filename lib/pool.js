// THE POOL A CONNECTION KEEPS. An app keeps two connections open while idle
// (min 2), ready for the next request. A test file does not: `node --test`
// runs many files at once (one per core), each its own process with pools to
// several databases, and two idle connections each filled Postgres' 100
// ("sorry, too many clients already") with connections doing nothing — 98 of
// 100 were idle at the peak. node marks every file it runs with
// NODE_TEST_CONTEXT, so there a pool keeps none idle and lets one go after a
// second. A `min` the caller gives is kept as given, 0 included.
var TEST_RUN = Boolean(process.env.NODE_TEST_CONTEXT);

function poolOf(given) {
  var p = given || {};
  var out = {
    min: p.min !== undefined && p.min !== null ? p.min : (TEST_RUN ? 0 : 2),
    max: p.max || 10
  };
  if (TEST_RUN) out.idleTimeoutMillis = 1000;
  return out;
}

module.exports = { poolOf: poolOf, TEST_RUN: TEST_RUN };
