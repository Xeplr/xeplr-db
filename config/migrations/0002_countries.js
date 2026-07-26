// xeplr_config baseline — reference data: countries.
// Natural key: ISO 3166-1 alpha-2 code as the primary id (stable, portable,
// human-readable), so states/business rows FK to a code that never changes.

exports.up = function (knex) {
  return knex.schema.createTable('countries', function (table) {
    table.string('id', 2).primary();               // ISO alpha-2, e.g. 'IN'
    table.string('iso3', 3).index();               // ISO alpha-3, e.g. 'IND'
    table.string('numeric_code', 3);               // ISO numeric, e.g. '356'
    table.string('name', 100).index();
    table.string('official_name', 200);
    table.string('phone_code', 20);
    table.string('currency', 3);                   // ISO 4217, e.g. 'INR'
    table.string('currency_name', 60);
    table.string('currency_symbol', 10);
    table.string('region', 40);
    table.string('subregion', 60);
    table.string('emoji', 16);                      // flag emoji

    table.timestamp('recordCreatedDate').defaultTo(knex.fn.now());
    table.timestamp('recordModifiedDate').defaultTo(knex.fn.now());
    table.boolean('isActive').defaultTo(true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('countries');
};
