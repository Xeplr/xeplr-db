#!/usr/bin/env node

// Load development.env from the cwd if dotenv is available — most consumers
// have it. Fail-soft so the CLI still runs in environments without dotenv.
try {
  var envName = (process.env.NODE_ENV || 'development') + '.env';
  require('dotenv').config({ path: require('path').join(process.cwd(), envName) });
} catch (_) {}

const { create, up, rollback, status, createSeed, seed } = require('../lib/migrator');
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
  const NEEDS_CONFIG = ['up', 'rollback', 'status', 'seed:run'];
  if (NEEDS_CONFIG.indexOf(command) !== -1) {
    if (!args.connectionName) {
      throw new Error('--connectionName (or --connection-name) is required for ' + command);
    }
    await resolveConfig(args.connectionName);
    // Fall back to DB_<NAME> env var if --db wasn't passed (or expanded as
    // empty by the shell because the var is only set inside development.env).
    if (!args.db || args.db === true) {
      args.db = process.env['DB_' + args.connectionName.toUpperCase()] || process.env.DB_NAME;
    }
  }

  switch (command) {
    case 'create': {
      const filepath = create(args._[1], { dir: args.dir });
      console.log(`Created: ${filepath}`);
      break;
    }
    case 'up': {
      const { batch, migrations } = await up(args);
      if (migrations.length === 0) {
        console.log('Already up to date');
      } else {
        console.log(`Batch ${batch} ran ${migrations.length} migrations:`);
        migrations.forEach(m => console.log(`  - ${m}`));
      }
      break;
    }
    case 'rollback': {
      const { batch, migrations } = await rollback(args);
      if (migrations.length === 0) {
        console.log('Nothing to rollback');
      } else {
        console.log(`Rolled back ${migrations.length} migrations:`);
        migrations.forEach(m => console.log(`  - ${m}`));
      }
      break;
    }
    case 'status': {
      const { completed, pending } = await status(args);
      console.log('Completed migrations:');
      completed.forEach(m => console.log(`  ✓ ${m}`));
      if (pending.length) {
        console.log('Pending migrations:');
        pending.forEach(m => console.log(`  ○ ${m}`));
      } else {
        console.log('No pending migrations');
      }
      break;
    }
    case 'seed:create': {
      const filepath = createSeed(args._[1], { seedsDir: args.seedsDir });
      console.log(`Created: ${filepath}`);
      break;
    }
    case 'seed:run': {
      const result = await seed(args);
      if (!result || result.length === 0) {
        console.log('No seed files to run');
      } else {
        console.log(`Ran ${result.length} seed files:`);
        result.forEach(s => console.log(`  - ${s}`));
      }
      break;
    }
    default:
      console.log('xeplr-migrate - Database migration & seed CLI');
      console.log('');
      console.log('Commands:');
      console.log('  create <name>       Create a new migration file');
      console.log('  up                  Run pending migrations');
      console.log('  rollback            Rollback last batch');
      console.log('  status              Show migration status');
      console.log('  seed:create <name>  Create a new seed file');
      console.log('  seed:run            Run seed files');
      console.log('');
      console.log('Options:');
      console.log('  --db              Database name (required)');
      console.log('  --connectionName  Resolved config name (e.g. api, auth, jobs)');
      console.log('  --dir             Migrations dir (default: ./migrations)');
      console.log('  --seedsDir        Seeds dir (default: ./seeds)');
      console.log('  --client          Knex client (default: pg)');
      console.log('');
      console.log('Requires ENCRYPTION_KEY and <NAME>_CONNECTION env vars.');
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
