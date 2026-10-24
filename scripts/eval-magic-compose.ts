/**
 * Magic Compose eval runner.
 *
 * Loads evals/magic-compose/dev-evals.json, calls the live LLM via
 * defaultLlmClient() for each `runner: "llm"` case, validates with the
 * production Zod schema, and interprets the eval DSL. Prints per-case
 * pass/fail and writes a snapshot to evals/magic-compose/snapshots/.
 *
 * A reply can be a draft, a refusal or questions. A case with `answers` runs
 * both calls the page makes: the prompt, which must ask, then the prompt with
 * the answers (`buildFollowUpMessages`), whose draft is scored.
 *
 * Usage:
 *   pnpm eval:magic-compose                       # all llm cases
 *   pnpm eval:magic-compose --case=ev_021         # single case
 *   pnpm eval:magic-compose --tag=cross_product   # by tag
 *   pnpm eval:magic-compose --tag=questions       # the cases about asking
 *   pnpm eval:magic-compose --list                # list cases without running
 *   pnpm eval:magic-compose --no-snapshot         # skip writing snapshot
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import path from 'node:path';
import { buildFollowUpMessages, FollowUpSchema } from '@/lib/magic-compose/follow-up';
import { defaultLlmClient } from '@/lib/magic-compose/llm-client';
import {
  buildMessages,
  isQuestionsReply,
  MagicComposeDraftSchema,
  type ChatMessage,
  type MagicComposeParsed,
} from '@/lib/magic-compose/prompt';
import { runEvalCli, type Produced } from './lib/eval-harness';

function isRefusal(p: MagicComposeParsed): p is { refusalReason: string } {
  return 'refusalReason' in p && typeof p.refusalReason === 'string';
}

/** One call to the model, read the way the route reads it. */
async function ask(messages: ChatMessage[]): Promise<Produced> {
  const client = defaultLlmClient();
  const t0 = Date.now();
  const res = await client.generateDraft(messages);
  const ms = Date.now() - t0;
  if (!res.ok) {
    return { status: 'llm_failed', code: res.error.code, message: res.error.message, ms };
  }

  const parsed = MagicComposeDraftSchema.safeParse(res.value);
  if (!parsed.success) {
    return { status: 'parse_failed', raw: res.value, issues: parsed.error.issues, ms };
  }
  if (isQuestionsReply(parsed.data)) {
    return { status: 'questions', raw: res.value, questions: parsed.data.questions, ms };
  }
  if (isRefusal(parsed.data)) {
    return { status: 'refusal', raw: res.value, refusalReason: parsed.data.refusalReason, ms };
  }
  return { status: 'draft', raw: res.value, draft: parsed.data, ms };
}

runEvalCli({
  snapshotDir: path.join(process.cwd(), 'evals/magic-compose/snapshots'),
  schemaName: 'MagicComposeDraftSchema',
  produce: (c) => ask(buildMessages(c.prompt)),
  async answer(c, answers) {
    // Checked as the route checks them, so a case can't send answers the page never would.
    const followUp = FollowUpSchema.safeParse(answers);
    if (!followUp.success) {
      const issue = followUp.error.issues[0];
      return {
        status: 'llm_failed',
        code: 'invalid_answers',
        message: `the case's answers fail FollowUpSchema at ${issue?.path.join('.')}: ${issue?.message}`,
        ms: 0,
      };
    }
    return ask(buildFollowUpMessages(c.prompt, followUp.data));
  },
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
