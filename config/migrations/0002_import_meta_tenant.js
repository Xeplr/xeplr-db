// import_meta becomes shared, cross-app control-plane data (not single-app):
// `service` says which app wrote a row, `mtId1`-`mtId4` scope it to a tenant
// within that app (same column names as BaseModel, for direct read
// compatibility), `details` is a free-form jsonb bag for app-specific
// context (filename, connectionId, dbInfoId, who ran it, ...) that the
// engine itself has no business knowing about. `details` is set once at
// recordStart and never touched by recordEnd — that's what the pre-existing
// `meta` column is for (engine-owned rollback bookkeeping).

exports.up = function (knex) {
  return knex.schema.alterTable('import_meta', function (table) {
    table.string('service', 100).notNullable().defaultTo('unknown');
    table.string('mtId1', 191);
    table.string('mtId2', 191);
    table.string('mtId3', 191);
    table.string('mtId4', 191);
    table.jsonb('details');

    table.index(['service', 'mtId1', 'mtId2'], 'import_meta_service_mt_idx');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('import_meta', function (table) {
    table.dropIndex(['service', 'mtId1', 'mtId2'], 'import_meta_service_mt_idx');
    table.dropColumn('service');
    table.dropColumn('mtId1');
    table.dropColumn('mtId2');
    table.dropColumn('mtId3');
    table.dropColumn('mtId4');
    table.dropColumn('details');
  });
};
