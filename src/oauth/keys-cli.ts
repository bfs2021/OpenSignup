/**
 * Rotate the OAuth access-token signing key.
 *
 * Usage:
 *   pnpm oauth:keys rotate        # add a new signing key, list the active ones
 *   pnpm oauth:keys retire <kid>  # stop trusting an old key
 *
 * After `rotate`, restart every web instance: the provider signs with the
 * newest key only once it restarts. Tokens the old key signed stay valid
 * until they expire, so wait at least `OAUTH_TTL.ACCESS_TOKEN` after the
 * restart before retiring it, or connected assistants get a 401 and have to
 * refresh. A retired key stops being trusted once each instance re-reads its
 * keys, within `SIGNING_KEY_CACHE_MAX_AGE`, with no restart. Lives under
 * `src/` rather than `scripts/` so the production image, which ships `src`
 * and `tsx`, can run it.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { getDb } from '@/db/client';
import { OAUTH_TTL, SIGNING_KEY_CACHE_MAX_AGE } from './config';
import { loadOrCreateSigningKeys, retireSigningKey, rotateSigningKey } from './keys';

async function printActiveKids(): Promise<void> {
  const { privateKeys } = await loadOrCreateSigningKeys(getDb());
  console.log('Active signing keys, newest first:');
  for (const key of privateKeys) console.log(`  ${key.kid}`);
}

async function main(): Promise<void> {
  const [command, kid] = process.argv.slice(2);
  if (command === 'rotate') {
    const newKid = await rotateSigningKey(getDb());
    console.log(`Added signing key ${newKid}.\n`);
    await printActiveKids();
    console.log(
      `\nRestart every web instance so it signs with the new key. After that, wait\n` +
        `${OAUTH_TTL.ACCESS_TOKEN / 60} minutes, then retire each older key with \`pnpm oauth:keys retire <kid>\`.`,
    );
  } else if (command === 'retire' && kid) {
    // The newest key is the one instances sign with, so it can't be retired;
    // rotate first. That also means the last active key is never retired.
    const kids = (await loadOrCreateSigningKeys(getDb())).privateKeys.map((k) => k.kid);
    if (!kids.includes(kid)) {
      console.error(`${kid} is not an active signing key.`);
      process.exit(1);
    }
    if (kids[0] === kid) {
      console.error(
        `${kid} is the newest key, which signs tokens. Run \`pnpm oauth:keys rotate\` first.`,
      );
      process.exit(1);
    }
    await retireSigningKey(getDb(), kid);
    console.log(
      `Retired ${kid}. Running instances stop trusting it within ` +
        `${SIGNING_KEY_CACHE_MAX_AGE / 60} minutes, with no restart.\n`,
    );
    await printActiveKids();
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
