// THE ONE CONVENTION for adding migrations to a xeplr library from outside it.
//
//   XEPLR_<APP>_MIGRATIONS      one or more directories, comma-separated
//
//   XEPLR_AUTH_MIGRATIONS       XEPLR_EMAIL_MIGRATIONS
//   XEPLR_JOBS_MIGRATIONS       XEPLR_WORKFLOW_MIGRATIONS
//   XEPLR_CONFIG_MIGRATIONS
//
// Read it as a sentence: xeplr's auth migrations. The vendor, the app, the
// thing — nothing else. There is no EXT, no EXTERNAL, no _DIR: those words
// describe the mechanism to whoever wrote the library, not the job to whoever
// is filling in a .env, and every one of them is a chance to get the name
// almost right.
//
// Knowing one variable means knowing all of them. Adding a library means
// adding a line that looks exactly like the lines already there.
//
//   var { migrationsFor } = require('@xeplr/db');
//   await sqlMigrator.up({
//     db: dbName,
//     dir: path.join(__dirname, 'migrations'),   // the library's own
//     extDir: migrationsFor('auth'),             // the app's, if any
//     type: 'precede',
//     connectionName: 'auth'
//   });
//
// ORDER is 'precede': the library's own migrations run FIRST, then the listed
// directories in order. That is the only order that can work, since an app's
// migration almost always references a table the library itself defines.
//
// The ledger is keyed by FILENAME ALONE, not by which directory a file came
// from, so apps contributing to the same library must keep their filenames
// distinct — the existing convention (`0001_workflow_access.sql`, not
// `0001_access.sql`) already does this.
//
// WHY IT IS CENTRAL: this parsing used to live inside one library's migrate
// CLI, so that CLI split the comma-separated list correctly while the same
// library's SERVER, reading the same variable through a different entry point,
// passed the raw string down — `path.resolve()` made "/a,/b,/c" one directory
// of that literal name, which does not exist, and a missing directory yields
// no files. One variable, two entry points, two behaviours, and no error
// anywhere. Splitting and existence-checking now live in resolveDirectories()
// (./migrator.js); this file is the naming half of the same convention.

/**
 * Migration directories an app contributes to a xeplr library, read from
 * XEPLR_<APP>_MIGRATIONS.
 *
 * Returns undefined when unset — contributing migrations is always OPTIONAL,
 * and undefined is what the migrators read as "the library's own directory
 * only".
 *
 * The raw value is returned unparsed on purpose: resolveDirectories() splits,
 * trims and checks that each directory exists, so a caller that passes a
 * string by hand gets exactly the same treatment as one that came through
 * here. There is no second place to keep in step.
 *
 * @param {string} app - the library's short name: 'auth', 'email', 'jobs',
 *   'workflow', 'config'. Case-insensitive.
 * @returns {string|undefined}
 */
function migrationsFor(app) {
  if (!app) throw new Error('migrationsFor: an app name is required, e.g. migrationsFor("auth")');
  return process.env[migrationsVar(app)] || undefined;
}

/**
 * The variable name for an app — for startup banners and error messages, so
 * they NAME the thing a reader has to go and set rather than describing it.
 *
 * @param {string} app
 * @returns {string} e.g. 'XEPLR_AUTH_MIGRATIONS'
 */
function migrationsVar(app) {
  return 'XEPLR_' + String(app).toUpperCase() + '_MIGRATIONS';
}

module.exports = { migrationsFor: migrationsFor, migrationsVar: migrationsVar };
