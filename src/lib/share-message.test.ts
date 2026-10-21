import { describe, expect, it } from 'vitest';
import { shareMessage, withLink } from './share-message';

const LINK = 'https://your-site.example/s/snack-duty-spring-season';

describe('shareMessage', () => {
  it('says the signup’s name and where to sign up, and nothing else', () => {
    expect(shareMessage('Snack duty — Spring season', LINK)).toBe(
      `Snack duty — Spring season\nSign up here: ${LINK}`,
    );
  });

  it('leaves out stray space around the name', () => {
    expect(shareMessage('  Bake sale ', LINK)).toBe(`Bake sale\nSign up here: ${LINK}`);
  });
});

describe('withLink', () => {
  it('copies the message as it is when the link is still in it', () => {
    const edited = `Hi all, snacks for the spring games.\nSign up here: ${LINK}`;
    expect(withLink(edited, LINK)).toBe(edited);
  });

  it('adds the link on its own line when the organizer took it out', () => {
    expect(withLink('Hi all, snacks for the spring games.', LINK)).toBe(
      `Hi all, snacks for the spring games.\n${LINK}`,
    );
  });

  it('is the link alone when the message was cleared', () => {
    expect(withLink('  \n ', LINK)).toBe(LINK);
  });

  it('trims space left at either end', () => {
    expect(withLink(`\n  See you there ${LINK}  \n`, LINK)).toBe(`See you there ${LINK}`);
  });
});
