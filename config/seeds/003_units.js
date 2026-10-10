// Seed the standard units from config/data/units.json, for every app and every
// company (applicationId = mtId1 = mtId2 = '*'). Idempotent: an upsert on id,
// so re-running bootstrap never duplicates, and a corrected factor in the JSON
// reaches every install on its next start. A company's own units are its own
// rows (see migrations/0006_units.js) and are never touched here.

var UNITS = require('../data/units.json');

exports.seed = async function (knex) {
  var rows = UNITS.map(function (u) {
    return {
      id: u.id, code: u.code, kind: u.kind, label: u.label, symbol: u.symbol, factor: u.factor,
      applicationId: '*', mtId1: '*', mtId2: '*', isActive: true
    };
  });
  await knex('units').insert(rows).onConflict('id').merge(['code', 'kind', 'label', 'symbol', 'factor', 'isActive']);
};
