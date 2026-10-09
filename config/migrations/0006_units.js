// UNITS — a master list every app converts with: kilograms to metric tons,
// metres to kilometres, litres to barrels.
//
// Each unit belongs to a KIND (weight, length, volume, area, energy, time) and
// carries its `factor` to that kind's base unit: 1 t = 1000 kg, so t's factor
// is 1000 in the weight kind whose base is kg. Any unit converts to any other
// of the same kind by those two factors, and units of different kinds never
// convert — there is nothing to ask.
//
// The standard units are seeded (seeds/003_units.js, data/units.json) with
// applicationId = mtId1 = mtId2 = '*': every app, every company. A company
// adds its own — a "bag" of 50 kg — as a row with its applicationId and its
// mtId1. The same three-level '*' convention templates use (0005), so "who can
// see this unit" is a fact you can SELECT.

exports.up = async function (knex) {
  await knex.schema.createTable('units', function (table) {
    table.string('id', 25).primary();
    // What a format names: 'kg', 't'. Short, stable, never shown alone.
    table.string('code', 32).notNullable();
    // weight | length | volume | area | energy | time — or a company's own.
    table.string('kind', 32).notNullable();
    table.string('label', 64).notNullable();
    // Appended after a converted number: '1,234.5 t'.
    table.string('symbol', 16).notNullable();
    // To the kind's base unit (the one whose factor is 1). Exact decimal: a
    // pound is 0.45359237 kg by definition, and a float would round it.
    table.decimal('factor', 38, 18).notNullable();

    table.string('applicationId', 100).notNullable().defaultTo('*').index();
    table.string('mtId1', 25).notNullable().defaultTo('*');
    table.string('mtId2', 25).notNullable().defaultTo('*');

    table.boolean('isActive').notNullable().defaultTo(true);
    table.timestamp('recordCreatedDate').defaultTo(knex.fn.now());
    table.timestamp('recordModifiedDate');
    table.string('recordCreatedBy', 25);
    table.string('recordModifiedBy', 25);
  });

  // One code per (application, company, workspace) among live rows; partial,
  // so a removed unit never blocks its replacement.
  await knex.raw(
    'CREATE UNIQUE INDEX "units_code_scope_active_idx" ' +
    'ON "units" ("applicationId", "code", "mtId1", "mtId2") WHERE "isActive"'
  );
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('units');
};
