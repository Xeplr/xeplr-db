// ONE DATABASE SERVER, ONE CONNECTION VARIABLE.
//
// Every xeplr service keeps its own DATABASE — auth's tables are not workflow's
// — but in practice they all live on the same server, reached with the same
// credentials. That was expressed as one env var per service
// (AUTH_DB_CONNECTION_INFO_ENCRYPTED, WORKFLOW_CONNECTION,
// XCFG_DB_CONNECTION_INFO_ENCRYPTED, ...) holding the same encrypted value,
// which made rotating the database password a four-place edit across every
// app. Miss one and nothing fails at deploy — it fails whenever that service
// next connects, which is the worst time to find out.
//
// So: XEPLR_DB_CONNECTION is the shared default, and a service-specific var
// still WINS when it is set.
//
// The per-service override is kept deliberately rather than collapsed away.
// The day auth has to sit on a locked-down instance, or one service needs a
// read-only user, that is a config change instead of a code change. It costs
// one line here; removing it would be a one-way door.
//
// NOTE this is only ever about WHERE the server is and who connects — never
// which database. Names stay per-service (AUTH_DB_NAME, DB_API, ...) and are
// untouched by any of this: the encrypted blob is { host, port, user,
// password } with no database in it, which is exactly what lets one connection
// serve databases with different names.

/**
 * Resolve a service's database connection from the environment.
 *
 * @param {string} serviceVar  the service's own env var name, e.g.
 *   'AUTH_DB_CONNECTION_INFO_ENCRYPTED'. Checked first so an install that has
 *   always set it keeps working with nothing to change.
 * @param {object} [opts]
 * @param {string} [opts.sharedVar='XEPLR_DB_CONNECTION']
 * @param {object} [opts.env=process.env]
 * @returns {string} the encrypted connection blob
 * @throws if neither is set — naming BOTH, because "AUTH_DB_CONNECTION_INFO_
 *   ENCRYPTED is not set" sends someone to configure a variable they may not
 *   need when the shared one would do.
 */
function resolveDbConnection(serviceVar, opts) {
  opts = opts || {};
  var env = opts.env || process.env;
  var sharedVar = opts.sharedVar || 'XEPLR_DB_CONNECTION';

  var specific = serviceVar ? env[serviceVar] : undefined;
  if (specific) return specific;

  var shared = env[sharedVar];
  if (shared) return shared;

  throw new Error(
    'No database connection configured — set ' + sharedVar +
    (serviceVar ? ' (shared by every xeplr service), or ' + serviceVar + ' to override it for this one.' : '.')
  );
}

/**
 * Which var a resolve WOULD use, without throwing. For startup logging: an
 * app that says which variable it connected through turns "why is it hitting
 * the wrong server" into a one-line answer.
 */
function describeDbConnection(serviceVar, opts) {
  opts = opts || {};
  var env = opts.env || process.env;
  var sharedVar = opts.sharedVar || 'XEPLR_DB_CONNECTION';
  if (serviceVar && env[serviceVar]) return serviceVar;
  if (env[sharedVar]) return sharedVar;
  return null;
}

module.exports = { resolveDbConnection: resolveDbConnection, describeDbConnection: describeDbConnection };
