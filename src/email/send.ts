import { createElement } from 'react';
import { getEmailTransport } from './index';
import { confirmationSubject, draftNudgeSubject, reminderSubject } from './subjects';
import {
  CommitmentConfirmationEmail,
  type CommitmentConfirmationEmailProps,
} from './templates/commitment-confirmation';
import { DraftNudgeEmail, type DraftNudgeEmailProps } from './templates/draft-nudge';
import { ReminderEmail, type ReminderEmailProps } from './templates/reminder';
import { renderEmail } from './render';

export async function sendCommitmentConfirmation(
  to: string,
  props: CommitmentConfirmationEmailProps,
) {
  const { html, text } = await renderEmail(createElement(CommitmentConfirmationEmail, props));
  return getEmailTransport().send({
    to,
    subject: confirmationSubject(props.signupTitle, props.slotSummary),
    html,
    text,
  });
}

export async function sendReminder(
  to: string,
  props: ReminderEmailProps,
  /**
   * RFC 8058 one-click target. Deliberately separate from
   * `props.unsubscribeUrl`: that one is the human-visible link to a confirm
   * page, while this is POSTed unattended by the mail provider and must be the
   * API route that actually applies the opt-out.
   */
  opts: { unsubscribePostUrl?: string } = {},
) {
  const { html, text } = await renderEmail(createElement(ReminderEmail, props));
  return getEmailTransport().send({
    to,
    subject: reminderSubject(props.signupTitle, props.slotSummary),
    html,
    text,
    ...oneClickUnsubscribe(opts.unsubscribePostUrl),
  });
}

/**
 * The organizer's one email about a draft they haven't published. Carries the
 * same RFC 8058 headers as a reminder, pointing at the draft-email opt-out
 * route (`draftEmailUnsubscribePostUrl`), for the same reason.
 */
export async function sendDraftNudge(
  to: string,
  props: DraftNudgeEmailProps,
  opts: { unsubscribePostUrl: string },
) {
  const { html, text } = await renderEmail(createElement(DraftNudgeEmail, props));
  return getEmailTransport().send({
    to,
    subject: draftNudgeSubject(props.signupTitle),
    html,
    text,
    ...oneClickUnsubscribe(opts.unsubscribePostUrl),
  });
}

function oneClickUnsubscribe(postUrl: string | undefined) {
  return postUrl
    ? {
        headers: {
          'List-Unsubscribe': `<${postUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }
    : {};
}
