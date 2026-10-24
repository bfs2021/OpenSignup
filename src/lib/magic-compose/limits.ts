/**
 * Magic Compose values the browser needs as well as the server. No imports, so
 * a client component can read them without pulling the server modules (or zod)
 * into the page's JavaScript.
 */

/** The rate-limit bucket Magic Compose drafts count against (`RateLimits.magicComposePerOrganizer`). */
export const MAGIC_COMPOSE_BUCKET = 'magic.compose';
