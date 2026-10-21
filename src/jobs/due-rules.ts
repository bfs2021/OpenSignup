import { sql, type SQL } from 'drizzle-orm';

/**
 * The names of the rules in `rules` that don't hold for the row in scope, as
 * one SQL text array, for the log line of a skipped send. It reads the same
 * rules the scan and the send job decide with, so the reasons can't drift
 * from the decision.
 */
export function failedRuleNames(rules: Record<string, SQL>): SQL<string[]> {
  const failed = Object.entries(rules).map(
    ([reason, rule]) => sql`CASE WHEN coalesce(${rule}, false) THEN NULL ELSE ${reason}::text END`,
  );
  return sql<string[]>`array_remove(ARRAY[${sql.join(failed, sql`, `)}], NULL)`;
}
