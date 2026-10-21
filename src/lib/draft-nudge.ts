/**
 * When an organizer gets the one email about a draft they haven't published
 * (#506). Plain numbers with no imports, so the help pages, the email and the
 * worker's scan all read the same ones.
 */

/**
 * Hours after a draft is created that its email becomes due. Typed `number`,
 * not the literal, so the help page's "an hour" / "N hours" check compiles.
 */
export const DRAFT_NUDGE_DELAY_HOURS: number = 3;

/**
 * Drafts created longer ago than this get no email at all. It bounds the scan,
 * so the first deploy, or a worker started after days stopped, doesn't email
 * every stale draft in the table at once; a draft the worker missed for two
 * days has been forgotten, and a late email about it would read as a surprise.
 */
export const DRAFT_NUDGE_MAX_AGE_HOURS = 48;
