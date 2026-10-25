import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { exportJWK, generateKeyPair, calculateJwkThumbprint, type JWK } from 'jose';
import { oauthSigningKeys } from '@/db/schema/oauth';
import type { Db } from '@/db/client';
import { log } from '@/lib/log';
import { OAUTH_TTL, SIGNING_ALG } from './config';

export interface SigningKeySet {
  /** Private JWKs, newest first. The first one signs. */
  privateKeys: JWK[];
  /** Public halves of the same keys, same order. */
  publicKeys: JWK[];
}

// Arbitrary but fixed; only has to differ from other advisory locks we take.
const KEY_BOOTSTRAP_LOCK = 7_240_001;

/**
 * Load every active signing key, creating the first one if the table is
 * empty. Creation runs under a transaction-scoped advisory lock so two web
 * instances booting at once cannot each mint a different "first" key and
 * then disagree about which one signed a token.
 */
export async function loadOrCreateSigningKeys(db: Db): Promise<SigningKeySet> {
  let rows = await activeKeys(db);
  if (rows.length === 0) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${KEY_BOOTSTRAP_LOCK})`);
      const existing = await tx
        .select({ kid: oauthSigningKeys.kid })
        .from(oauthSigningKeys)
        .where(isNull(oauthSigningKeys.retiredAt))
        .limit(1);
      if (existing.length > 0) return;
      const jwk = await generatePrivateJwk();
      await tx.insert(oauthSigningKeys).values({ kid: jwk.kid!, alg: SIGNING_ALG, jwk });
      log.info({ kid: jwk.kid }, 'oauth: generated initial signing key');
    });
    rows = await activeKeys(db);
  }
  const privateKeys = rows.map((r) => r.jwk as JWK);
  return { privateKeys, publicKeys: privateKeys.map(publicJwk) };
}

/**
 * Add a fresh key at the front. Existing keys stay active so tokens they
 * signed remain verifiable; retire them with `retireSigningKey` once every
 * token that could carry their `kid` has expired (`OAUTH_TTL.ACCESS_TOKEN`).
 * The running provider only picks the new key up on restart.
 */
export async function rotateSigningKey(db: Db): Promise<string> {
  const jwk = await generatePrivateJwk();
  await db.insert(oauthSigningKeys).values({ kid: jwk.kid!, alg: SIGNING_ALG, jwk });
  return jwk.kid!;
}

/**
 * Record that an instance has started signing with `kid`. Written once per
 * key: the first instance to build its provider with it sets the time, and
 * later ones leave it alone. `retireSigningKey` reads it to tell "rotated and
 * restarted" from "rotated and forgot to restart".
 */
export async function markSigningKeyInUse(db: Db, kid: string): Promise<void> {
  await db
    .update(oauthSigningKeys)
    .set({ signingSince: sql`now()` })
    .where(and(eq(oauthSigningKeys.kid, kid), isNull(oauthSigningKeys.signingSince)));
}

export type RetireOutcome = 'retired' | 'unknown' | 'in_use';

/**
 * Stop trusting `kid`. Refused (`in_use`) unless a newer active key has been
 * signing for at least an access token's lifetime: until then, an instance
 * may still sign with `kid`, or a token it signed may still be live, and
 * retiring it would turn those tokens into 401s. This shows one instance
 * moved on, not every one, which is why the docs still say to restart them
 * all before retiring.
 */
export async function retireSigningKey(db: Db, kid: string): Promise<RetireOutcome> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ kid: oauthSigningKeys.kid })
      .from(oauthSigningKeys)
      .where(and(eq(oauthSigningKeys.kid, kid), isNull(oauthSigningKeys.retiredAt)))
      .for('update');
    if (!target) return 'unknown';
    const [successor] = await tx
      .select({ kid: oauthSigningKeys.kid })
      .from(oauthSigningKeys)
      .where(
        and(
          isNull(oauthSigningKeys.retiredAt),
          // Compared in SQL: a JS Date would drop created_at's microseconds.
          sql`${oauthSigningKeys.createdAt} > (select created_at from oauth_signing_keys where kid = ${kid})`,
          sql`${oauthSigningKeys.signingSince} <= now() - make_interval(secs => ${OAUTH_TTL.ACCESS_TOKEN})`,
        ),
      )
      .limit(1);
    if (!successor) return 'in_use';
    await tx
      .update(oauthSigningKeys)
      .set({ retiredAt: sql`now()` })
      .where(eq(oauthSigningKeys.kid, kid));
    return 'retired';
  });
}

/** Every active key, newest first, with when instances started signing with it. */
export async function listSigningKeys(db: Db) {
  return db
    .select({
      kid: oauthSigningKeys.kid,
      createdAt: oauthSigningKeys.createdAt,
      signingSince: oauthSigningKeys.signingSince,
    })
    .from(oauthSigningKeys)
    .where(isNull(oauthSigningKeys.retiredAt))
    .orderBy(desc(oauthSigningKeys.createdAt));
}

async function activeKeys(db: Db) {
  return db
    .select({ kid: oauthSigningKeys.kid, jwk: oauthSigningKeys.jwk })
    .from(oauthSigningKeys)
    .where(isNull(oauthSigningKeys.retiredAt))
    .orderBy(desc(oauthSigningKeys.createdAt));
}

export async function generatePrivateJwk(): Promise<JWK> {
  const { privateKey } = await generateKeyPair(SIGNING_ALG, { extractable: true });
  const jwk = await exportJWK(privateKey);
  jwk.kid = await calculateJwkThumbprint(jwk);
  jwk.alg = SIGNING_ALG;
  jwk.use = 'sig';
  return jwk;
}

/** Strip the private members of an EC/RSA/OKP JWK. */
export function publicJwk(jwk: JWK): JWK {
  const { d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, oth: _oth, ...pub } = jwk;
  return pub;
}
