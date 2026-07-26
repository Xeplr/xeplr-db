// Seed countries from config/data/countries.json. Idempotent (upsert on id),
// so re-running bootstrap never duplicates or errors. To expand coverage,
// replace/extend the JSON — the loader handles any size (chunked insert).

var COUNTRIES = require('../data/countries.json');

exports.seed = async function (knex) {
  var rows = COUNTRIES.map(function (c) {
    return {
      id:              c.iso2,
      iso3:            c.iso3,
      numeric_code:    c.numeric || null,
      name:            c.name,
      official_name:   c.official_name || null,
      phone_code:      c.phone_code || null,
      currency:        c.currency || null,
      currency_name:   c.currency_name || null,
      currency_symbol: c.currency_symbol || null,
      region:          c.region || null,
      subregion:       c.subregion || null,
      emoji:           c.emoji || null
    };
  });

  var CHUNK = 200;
  for (var i = 0; i < rows.length; i += CHUNK) {
    await knex('countries').insert(rows.slice(i, i + CHUNK)).onConflict('id').merge();
  }
};
