/**
 * Rotate the OAuth access-token signing key.
 *
 * Usage:
 *   pnpm oauth:keys rotate        # add a new signing key, list the active ones
 *   pnpm oauth:keys retire <kid>  # stop trusting an old key
 *
 * After `rotate`, restart every web instance: the provider signs with the
 * newest key only once it restarts. Tokens the old key signed stay valid
 * until they expire, so `retire` refuses an old key until a newer one has
 * been signing for `OAUTH_TTL.ACCESS_TOKEN`. A retired key stops being
 * trusted once each instance re-reads its keys, within
 * `SIGNING_KEY_CACHE_MAX_AGE`, with no restart. Lives under `src/` rather
 * than `scripts/` so the production image, which ships `src` and `tsx`, can
 * run it.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { getDb } from '@/db/client';
import { OAUTH_TTL, SIGNING_KEY_CACHE_MAX_AGE } from './config';
import { listSigningKeys, retireSigningKey, rotateSigningKey } from './keys';

const TOKEN_MINUTES = OAUTH_TTL.ACCESS_TOKEN / 60;

async function printActiveKeys(): Promise<void> {
  console.log('Active signing keys, newest first:');
  for (const key of await listSigningKeys(getDb())) {
    const signing = key.signingSince
      ? `signing since ${key.signingSince.toISOString()}`
      : 'not signed with yet (restart the web instances)';
    console.log(`  ${key.kid}  created ${key.createdAt.toISOString()}, ${signing}`);
  }
}

async function main(): Promise<void> {
  const [command, kid, ...rest] = process.argv.slice(2);
  if (command === 'rotate' && !kid) {
    const newKid = await rotateSigningKey(getDb());
    console.log(`Added signing key ${newKid}.\n`);
    await printActiveKeys();
    console.log(
      `\nRestart every web instance so it signs with the new key. Then wait ${TOKEN_MINUTES} minutes,\n` +
        'so every token an older key signed has expired, and retire each older key with\n' +
        '`pnpm oauth:keys retire <kid>`.',
    );
  } else if (command === 'retire' && kid && rest.length === 0) {
    const outcome = await retireSigningKey(getDb(), kid);
    if (outcome === 'unknown') {
      console.error(`${kid} is not an active signing key.\n`);
      await printActiveKeys();
      process.exit(1);
    }
    if (outcome === 'in_use') {
      console.error(
        `${kid} may still be signing tokens, or a token it signed may still be live.\n` +
          `Retire it once a newer key has been signing for ${TOKEN_MINUTES} minutes: run\n` +
          '`pnpm oauth:keys rotate` if there is no newer key, restart every web instance, and wait.\n',
      );
      await printActiveKeys();
      process.exit(1);
    }
    console.log(
      `Retired ${kid}. Running instances stop trusting it within ` +
        `${SIGNING_KEY_CACHE_MAX_AGE / 60} minutes, with no restart.\n`,
    );
    await printActiveKeys();
  } else {
    console.error('Usage: pnpm oauth:keys rotate | pnpm oauth:keys retire <kid>');
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
