#!/usr/bin/env node

// Reads process.env ONLY. The consuming app loads its .env (e.g. via dotenv-cli
// in the npm script) — @xeplr/* packages never read .env files.

const { create, up, status } = require('../lib/sqlMigrator');
const { resolveConfig } = require('../lib/connection');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] || true;
      i++;
    } else {
      args._.push(argv[i]);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  // Resolve connection config up-front for any command that touches the DB.
  // The CLI accepts either --connectionName or --connection-name, mapping both
  // to args.connectionName before passing through to the migrator.
  if (args['connection-name'] && !args.connectionName) {
    args.connectionName = args['connection-name'];
  }
  const NEEDS_CONFIG = ['up', 'status', 'create-db'];
  if (NEEDS_CONFIG.indexOf(command) !== -1) {
    if (!args.connectionName) {
      throw new Error('--connectionName (or --connection-name) is required for ' + command);
    }
    // The app tells us WHICH secret to use, decoupled from the connection name:
    //   --connection <encrypted>     the secret itself, or
    //   --connection-env <ENV_NAME>  the env var holding it (read after dotenv).
    // Omit both → legacy fallback to <connectionName>_CONNECTION inside resolveConfig.
    var connSource = args.connection ||
      (args['connection-env'] && process.env[args['connection-env']]) || undefined;
    await resolveConfig(args.connectionName, connSource);
    // db name: --db <name>, or --db-env <ENV_NAME> (app names it), or DB_<connName>.
    if (!args.db || args.db === true) {
      args.db = (args['db-env'] && process.env[args['db-env']]) ||
        process.env['DB_' + args.connectionName.toUpperCase()] || process.env.DB_NAME;
    }
  }

  switch (command) {
    case 'create': {
      const filepath = create(args._[1], { dir: args.dir });
      console.log(`Created: ${filepath}`);
      break;
    }
    case 'up': {
      const { migrations } = await up(args);
      if (migrations.length === 0) {
        console.log('Already up to date');
      } else {
        console.log(`Ran ${migrations.length} migrations:`);
        migrations.forEach(m => console.log(`  - ${m}`));
      }
      break;
    }
    case 'status': {
      const { completed, pending, drift } = await status(args);
      console.log('Completed migrations:');
      completed.forEach(m => console.log(`  ✓ ${m}`));
      if (pending.length) {
        console.log('Pending migrations:');
        pending.forEach(m => console.log(`  ○ ${m}`));
      } else {
        console.log('No pending migrations');
      }
      if (drift.length) {
        console.log('WARNING - applied migrations edited after the fact (checksum mismatch):');
        drift.forEach(m => console.log(`  ! ${m}`));
      }
      break;
    }
    case 'create-db': {
      // Reuse ensureDatabase() — same logic the xeplr_config bootstrap uses.
      const { getResolvedConfig } = require('../lib/connection');
      const { ensureDatabase } = require('../lib/bootstrap-config');
      const res = await ensureDatabase(getResolvedConfig(args.connectionName), args.db);
      console.log(res.created ? ('Created database: ' + args.db) : ('Database already exists: ' + args.db));
      break;
    }
    default:
      console.log('xeplr-migrate - SQL migration CLI');
      console.log('');
      console.log('Commands:');
      console.log('  create <name>       Create a new (empty) .sql migration file');
      console.log('  create-db           Create the database if it does not exist');
      console.log('  up                  Run pending migrations');
      console.log('  status              Show migration status (completed/pending/drift)');
      console.log('');
      console.log('Options:');
      console.log('  --db              Database name (falls back to DB_<NAME> env)');
      console.log('  --connectionName  Resolved config name (e.g. api, auth, jobs)');
      console.log('  --dir             Migrations dir (default: ./migrations)');
      console.log('  --extDir          Additional (app) migrations dir, layered per --type');
      console.log('  --type            precede|succeed|override (default: precede)');
      console.log('');
      console.log('Migrations are hand-written .sql files, applied once, no down(). Reference');
      console.log('env vars in a file as ${VAR_NAME} — substituted at apply time.');
      console.log('');
      console.log('Requires ENCRYPTION_KEY and <NAME>_CONNECTION env vars.');
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
