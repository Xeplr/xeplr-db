#!/usr/bin/env node

const { create, up, rollback, status, createSeed, seed } = require('../lib/migrator');

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
