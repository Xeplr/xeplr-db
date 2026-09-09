// xeplr_configs is THE shared store — every xeplr app opens it — so every
// table in it needs to say which application owns each row. This is the
// migration that makes that true, and it is the only database in the
// framework that gets it by default (a product with its own embeddable tables
// runs the same sweep against its own; see @xeplr-workflow/api).
//
// WHY A COLUMN AND NOT THE EXISTING `service`:
//
// `service` is set from attachConfig({ service }), which each PACKAGE
// hardcodes to its own name. When xeplr-bi embeds @xeplr-workflow/api, a
// movement run by a workflow step is recorded as service='xeplr-workflow' —
// identical to the same step running inside ERP. It says which CODE wrote the
// row, which is worth keeping for debugging, but it cannot say which PRODUCT
// owns it. applicationId is the deployment's identity and is what every read
// filters on.
//
// WHY NOT mtId1: a companyId is minted by each app's own `companies` table,
// so the same string in two apps is two unrelated tenants. In a shared table
// the real key is (applicationId, mtId1, mtId2) — mtId1 alone is not unique
// and must never be joined across apps.
//
// countries/states are reference data every app reads, so they are backfilled
// with '*' (APP_ALL) rather than an owner — see BaseModel's `application`
// modifier, which matches the registered app OR '*'.

var { addApplicationIdColumns } = require('../../lib/application-column');

exports.up = async function (knex) {
  await addApplicationIdColumns(knex, {
    // Everything already in import_meta was written before this column
    // existed, by whichever app's uploader ran it. `service` is the only
    // record of that, so it is what we backfill from below — this literal is
    // just the NOT NULL default the ALTER needs.
    applicationId: 'unknown',
    sharedTables: ['countries', 'states']
  });

  // Best available truth for rows that predate the column: the package that
  // wrote them. For a standalone deployment that IS the application id; for
  // an embedded one it is wrong but visible, and 'unknown' would be neither.
  await knex('import_meta')
    .where('applicationId', 'unknown')
    .update({ applicationId: knex.ref('service') });
};

exports.down = async function (knex) {
  for (var table of ['import_meta', 'countries', 'states']) {
    await knex.schema.alterTable(table, function (t) {
      t.dropColumn('applicationId');
    });
  }
};
