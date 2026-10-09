// Which migration directories run, and in what order — the one copy, shared by
// the knex migrator, the SQL migrator and the config-DB bootstrap.
//
// No dependencies beyond Node itself, on purpose: the config bootstrap needs
// this, and requiring it through ./migrator would load the connection layer
// (and its peers) into a process that only wanted xeplr_configs migrated.

const path = require('path');
const fs = require('fs');

/**
 * Resolve ordered directories based on type.
 *
 * `extDir` accepts one path OR an array of them — one library (e.g.
 * @xeplr/auth) is shared by several consuming apps that each own their own
 * extension migrations (workflow's, jobs', BI's own), and more than one of
 * those app directories can need to apply against the SAME target database
 * in a single run (one controlled deploy process, rather than every
 * consuming app individually credentialed to migrate a shared database).
 * Each ext directory keeps its own place in the ledger by filename, so
 * sibling apps must keep their migration filenames distinct (this app's
 * convention — `0001_workflow_access.sql`, not `0001_access.sql` — already
 * does that).
 *
 * @param {string} ownDir - The library's own directory
 * @param {string|string[]} extDir - The external (project) directory, or
 *   several: an array, or ONE COMMA-SEPARATED STRING (what an env var gives).
 * @param {string} type   - 'precede' | 'override' | 'succeed'
 * @returns {string[]} Ordered array of directories to run
 * @throws if any extension directory does not exist
 */
function resolveDirectories(ownDir, extDir, type) {
  if (!extDir || (Array.isArray(extDir) && extDir.length === 0)) return [ownDir];

  // A COMMA-SEPARATED STRING IS SPLIT HERE, at the bottom of the stack, and
  // that placement is the point.
  //
  // Extension dirs reach this function from an env var, which can only ever
  // be a string, so "several directories" has to survive as "one string with
  // commas". Splitting it used to live in ONE library's CLI
  // (xeplr-auth-migrate's parseExtDir) — so `xeplr-auth-migrate up` applied
  // every extension directory, while `xeplr-auth-server`, reading the same
  // variable through boot(), passed the raw string down and path.resolve()
  // turned "/a,/b,/c" into a single directory of that literal name. It does
  // not exist, listSqlFiles() returns [] for a missing directory, and the
  // server therefore applied NONE of the extension migrations without saying
  // a word.
  //
  // One variable, two entry points, two behaviours, no error. Parsing it here
  // means every caller — every library, every CLI, every future one — gets
  // the same answer without having to know the convention.
  var raw = Array.isArray(extDir) ? extDir : String(extDir).split(',');
  var extDirs = raw
    .map(function(d) { return String(d).trim(); })
    .filter(Boolean)
    .map(function(d) { return path.resolve(d); });

  if (extDirs.length === 0) return [ownDir];

  // A directory that is not there is a CONFIGURATION ERROR, not an empty
  // contribution. Left unchecked it is invisible: zero files, zero
  // migrations, a clean boot, and a missing table or menu row discovered much
  // later by something unrelated. Name the path that is wrong, at the moment
  // we still know which one it was.
  var missing = extDirs.filter(function(d) { return !fs.existsSync(d); });
  if (missing.length) {
    throw new Error(
      'Migration directory does not exist:\n' +
      missing.map(function(d) { return '  - ' + d; }).join('\n') +
      '\nAn extension directory that is absent contributes nothing and would otherwise ' +
      'do so silently. Fix the path, or remove it from the list.');
  }

  switch (type) {
    case 'override':
      return extDirs;
    case 'succeed':
      return extDirs.concat([path.resolve(ownDir)]);
    case 'precede':
    default:
      return [path.resolve(ownDir)].concat(extDirs);
  }
}

module.exports = { resolveDirectories };
