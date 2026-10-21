/**
 * Every on-screen name "Create and publish your first signup" relies on. The
 * article prints them and its walkthrough (`tests/e2e/help/`) finds them by
 * the same strings, so renaming one of these on screen fails that test until
 * it is changed here, and the article changes with it. No imports: the
 * Playwright runner loads this file too.
 */
export const UI = {
  yourSignups: 'Your signups',
  newSignup: 'New signup',
  // Only on sites that offer drafting from a description.
  composeHeading: 'What are you organizing?',
  skipCompose: 'Skip, fill in by hand',
  draftCompose: 'Draft my signup',
  title: 'Title',
  description: 'Description (optional)',
  createSignup: 'Create signup',
  emptySlot: 'Set what',
  what: 'What',
  date: 'Date',
  capacity: 'Capacity',
  done: 'Done',
  addSlot: 'Add a slot',
  duplicate: 'Duplicate',
  delete: 'Delete',
  // What people see on the signup page for a slot left empty.
  untitledSlot: 'Untitled slot',
  // A draft with a slot filled in opens on this page, from Your signups and
  // after drafting from a description.
  reviewHeading: 'Check your signup, then share it',
  // A problem the review page can fix there and then: this one's button for
  // one slot with nothing in it ("Remove them" for several), Undo for the last
  // fix, and the link the others have instead.
  removeBlankSlot: 'Remove it',
  undo: 'Undo',
  fixInBuilder: 'Fix in the builder',
  // Each of its cards' button; the test finds it by its card.
  change: 'Change',
  editInBuilder: 'Edit everything in the builder',
  publishFromReview: 'Publish and get the link',
  // Under those two: sends the email about an unpublished draft now.
  emailMeLater: 'Not yet. Email me a link to finish later',
  preview: 'Preview',
  publish: 'Publish',
  // Phones: the three-dot button's accessible name, then the item it opens.
  moreActions: 'More actions',
  publishOnPhone: 'Publish signup',
  // Publishing, from any of the three buttons above, lands on this page.
  shareHeading: "It's live. Now send the link.",
  copyLink: 'Copy link',
  // Only where the browser has a share sheet, as most phones do.
  share: 'Share…',
  messageBox: 'A message to send with it',
  copyMessage: 'Copy message and link',
  downloadQr: 'Download QR code',
  doneSharing: 'Done, go to my signup',
  // The link at the top of every tab, for copying it again later.
  publicLink: 'Public link',
  // An icon-only button: the article says "the copy button"; the test uses this.
  copyPublicLink: 'Copy public link',
  // On the signup page people open: each slot's button starts with this.
  signUp: 'Sign up',
  // The button reads "Fields (2)"; the count changes, so the test matches the start.
  fields: 'Fields',
  reminderToggle: 'Send a reminder email before this date',
  // The Fields dialog's button, and the Settings tab's.
  save: 'Save',
  // The Settings tab, and its choice of whether people must give an email.
  settings: 'Settings',
  signupForm: 'Sign-up form',
  askForEmail: 'Ask for an email address',
  emailRequired: 'Required',
  emailOptional: 'Optional',
  saved: 'Saved',
  // The email box on the signup page once it is optional.
  emailBoxOptional: 'Email (optional)',
  // The tab that lists who signed up.
  responses: 'Responses',
} as const;
