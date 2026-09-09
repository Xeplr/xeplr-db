// TEMPLATES — named, reusable bodies, in the store every app opens.
//
// ── WHY HERE AND NOT IN @xeplr/email's OWN DATABASE ──────────────────────
//
// It started there, and the reasoning was sound while email was the only
// consumer: templates are app-specific, so each product owned its own store
// and could not clobber another's "User Registration" by name.
//
// What changed is the number of consumers. A template is a body with {{...}}
// holes in it, and that is not an email-shaped idea: an invoice, an SMS
// (@xeplr/utils has lib/sms.js), an in-app notification and a workflow human
// task all want exactly the same thing. Once a second PRODUCT — a CRM
// automation — wants the same library, a per-app store stops being isolation
// and starts being duplication.
//
// xeplr_configs is the store for precisely that: shared reference data every
// app opens, and the one database in the framework where `applicationId` is a
// real boundary rather than a constant column.
//
// ── SUBJECT IS NULLABLE, AND THAT IS THE POINT ───────────────────────────
//
// email_templates had `subject NOT NULL`, which quietly made every template an
// email whether or not anyone said so. An invoice has no subject; an SMS has
// neither subject nor html. The SENDER requires what it needs — @xeplr/email
// refuses a template with no subject — and the store stays a body with holes.
// No `type` column: one list, whatever the body is for.
//
// ── THE THREE-LEVEL DEFAULT ──────────────────────────────────────────────
//
//   applicationId  which product's library this belongs to; '*' = every one
//   mtId1 / mtId2  company / workspace; '*' = every one
//
// '*' rather than NULL throughout, so "who can read this" stays a fact you can
// SELECT (the same convention countries and states use). A registration or
// invitation mail resolves at ('*', '*') because it is sent BEFORE the
// recipient has joined anything — there is no company to brand it as yet.

exports.up = async function (knex) {
  await knex.schema.createTable('templates', function (table) {
    table.string('id', 25).primary();
    table.string('name', 128).notNullable();
    table.text('description');
    // Nullable: an invoice and an SMS have no subject. See above.
    table.text('subject');
    table.text('html');
    table.text('text');
    // [{ name, description, required }] — the DECLARED variables the body
    // expects, so a caller's UI can render a form and catch a missing value
    // before sending rather than mailing somebody "Hello ,".
    table.jsonb('variables').notNullable().defaultTo('[]');

    // varchar(100), matching what lib/application-column.js adds elsewhere —
    // a shared column that is a different width per table is a join waiting to
    // surprise somebody.
    table.string('applicationId', 100).notNullable().defaultTo('*').index();
    table.string('mtId1', 25).notNullable().defaultTo('*');
    table.string('mtId2', 25).notNullable().defaultTo('*');

    table.boolean('isActive').notNullable().defaultTo(true);
    table.timestamp('recordCreatedDate').defaultTo(knex.fn.now());
    table.timestamp('recordModifiedDate');
    table.string('recordCreatedBy', 25);
    table.string('recordModifiedBy', 25);
  });

  // One name per (application, company, workspace) among LIVE rows. Partial,
  // so a soft-deleted template never blocks creating its replacement — the
  // same trap 0001_email_templates.sql called out.
  await knex.raw(
    'CREATE UNIQUE INDEX "templates_name_scope_active_idx" ' +
    'ON "templates" ("applicationId", "name", "mtId1", "mtId2") WHERE "isActive"'
  );

  // Resolution reads by name and walks the scopes outward on every send.
  await knex.raw(
    'CREATE INDEX "templates_lookup_idx" ' +
    'ON "templates" ("name", "applicationId", "mtId1", "mtId2") WHERE "isActive"'
  );
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('templates');
};
