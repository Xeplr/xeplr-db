// Seed states from config/data/states.json. Idempotent (upsert on id).
// id = '<country_iso2>-<state_code>'. Depends on 001_countries running first
// (FK to countries.id) — seed files run in filename order.

var STATES = require('../data/states.json');

exports.seed = async function (knex) {
  var rows = STATES.map(function (s) {
    return {
      id:         s.country + '-' + s.code,
      country_id: s.country,
      name:       s.name,
      state_code: s.code,
      type:       s.type || null
    };
  });

  var CHUNK = 200;
  for (var i = 0; i < rows.length; i += CHUNK) {
    await knex('states').insert(rows.slice(i, i + CHUNK)).onConflict('id').merge();
  }
};
