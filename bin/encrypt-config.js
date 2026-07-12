#!/usr/bin/env node

/**
 * Generate an encrypted DB connection string.
 *
 * Usage:
 *   xeplr-db-encrypt --name api --host localhost --port 5432 --user postgres --password mypass
 *
 * Reads ENCRYPTION_KEY from env.
 * Output: the encrypted string to put in <NAME>_CONNECTION env var.
 */

var { encrypt } = require('@xeplr/utils/isomorphic/crypto');

function parseArgs(argv) {
  var args = {};
  for (var i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] || '';
      i++;
    }
  }
  return args;
}

async function main() {
  var args = parseArgs(process.argv.slice(2));

  var config = {
    host: args.host || 'localhost',
    port: parseInt(args.port || '5432'),
    user: args.user || 'postgres',
    password: args.password || ''
  };

  var key = args.key || process.env.ENCRYPTION_KEY;
  if (!key) {
    console.error('Encryption key required: --key <key> or ENCRYPTION_KEY env var');
    process.exit(1);
  }

  var name = (args.name || 'DB').toUpperCase();
  var envVar = name + '_CONNECTION';

  var encrypted = await encrypt(JSON.stringify(config), key);
  console.log('\nEncrypted connection string for ' + name + ':\n');
  console.log(encrypted);
  console.log('\nAdd to your .env file:');
  console.log(envVar + '=' + encrypted);
}

main().catch(function(err) {
  console.error(err.message);
  process.exit(1);
});
