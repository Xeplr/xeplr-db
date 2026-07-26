// xeplr_config baseline — import/movement metadata (control-plane).
// This is the framework-owned meta store the uploader writes to
// (recordStart/recordProgress/recordEnd/getLast). It holds NO secrets:
// `connection_key` is an OPAQUE label the consumer resolves via their own
// db_info — never a FK to it, since db_info is consumer-owned.

exports.up = function (knex) {
  return knex.schema.createTable('import_meta', function (table) {
    table.string('id', 64).primary();              // = movementId (correlation key)
    table.string('connection_key', 191).index();   // opaque target-connection label
    table.string('target_table', 191).index();
    table.string('db_type', 20);                    // postgres | mysql | mssql
    table.string('status', 20).index();             // running|completed|aborted|rolled-back|error

    table.jsonb('primary_keys');                    // upsert keys for this movement
    table.jsonb('columns');                         // inferred/reconciled column plan

    table.bigInteger('total_rows').defaultTo(0);
    table.bigInteger('total_batches').defaultTo(0);
    table.bigInteger('completed').defaultTo(0);
    table.bigInteger('dropped').defaultTo(0);

    table.text('error');
    table.jsonb('meta');                            // extensibility without migrations

    table.timestamp('started_at');
    table.timestamp('ended_at');

    table.timestamp('recordCreatedDate').defaultTo(knex.fn.now());
    table.timestamp('recordModifiedDate').defaultTo(knex.fn.now());
    table.boolean('isActive').defaultTo(true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('import_meta');
};
