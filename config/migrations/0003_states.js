// xeplr_config baseline — reference data: states / provinces / regions.
// Natural key: '<country_iso2>-<state_code>' (ISO 3166-2 style), e.g. 'IN-MH'.
// FKs to countries.id (the alpha-2 code).

exports.up = function (knex) {
  return knex.schema.createTable('states', function (table) {
    table.string('id', 12).primary();              // e.g. 'IN-MH', 'US-CA'
    table.string('country_id', 2).notNullable().index();
    table.string('name', 120).index();
    table.string('state_code', 10);                // subdivision code, e.g. 'MH'
    table.string('type', 40);                      // state | union territory | province | ...

    table.timestamp('recordCreatedDate').defaultTo(knex.fn.now());
    table.timestamp('recordModifiedDate').defaultTo(knex.fn.now());
    table.boolean('isActive').defaultTo(true);

    table.foreign('country_id').references('id').inTable('countries');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('states');
};
