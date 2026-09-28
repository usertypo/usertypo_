#!/usr/bin/env node
/**
 * Set the admin action password (asked before deleting accounts, purging
 * scores, logging in as a user or creating one-time sign-in links).
 *
 * Only a salted PBKDF2 hash is stored, as the ADMIN_ACTION_PASSWORD_HASH
 * secret on the admin Worker. Nothing is written to the repo.
 *
 * Usage: npm run admin:set-password               (dev + production)
 *        npm run admin:set-password -- dev        (one environment)
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ITERATIONS = 100000; // Cloudflare Workers' PBKDF2 limit
const MIN_LENGTH = 12;
const VALID_ENVS = ['dev', 'production'];

const workerDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workers', 'admin');
const envs = process.argv.slice(2).length ? process.argv.slice(2) : VALID_ENVS;
const unknown = envs.filter((e) => !VALID_ENVS.includes(e));
if (unknown.length) {
  console.error(`Unknown environment(s): ${unknown.join(', ')}. Use: ${VALID_ENVS.join(', ')}`);
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (text) => {
      if (!muted) rl.output.write(text);
      else if (/[\r\n]/.test(text)) rl.output.write('\n');
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

const password = await askHidden('New admin action password: ');
if (password.length < MIN_LENGTH) {
  console.error(`Use at least ${MIN_LENGTH} characters.`);
  process.exit(1);
}
const again = await askHidden('Type it again: ');
if (again !== password) {
  console.error('Passwords did not match. Nothing was changed.');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
const secret = `pbkdf2-sha256$${ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;

let failed = false;
for (const env of envs) {
  console.log(`\nSetting ADMIN_ACTION_PASSWORD_HASH on the ${env} admin Worker…`);
  const result = spawnSync('npx', ['wrangler', 'secret', 'put', 'ADMIN_ACTION_PASSWORD_HASH', '--env', env], {
    cwd: workerDir,
    input: secret + '\n',
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    failed = true;
    console.error(`Failed for ${env}.`);
  }
}

console.log(failed ? '\nSome environments failed; see above.' : '\nDone. The new password works immediately; old unlocks are revoked.');
process.exit(failed ? 1 : 0);
