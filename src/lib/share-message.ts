/**
 * The message the share step offers to send with a signup's link: its name
 * and the link, in fixed words. Nothing else, since anything more (a date, a
 * greeting, who it's for) would be a guess. The organizer can change it
 * before they copy it.
 */
export function shareMessage(title: string, url: string): string {
  return `${title.trim()}\nSign up here: ${url}`;
}

/**
 * What "Copy message and link" copies: the message as the organizer left it,
 * with the link added on a line of its own if they took it out.
 */
export function withLink(message: string, url: string): string {
  const text = message.trim();
  if (text.includes(url)) return text;
  return text ? `${text}\n${url}` : url;
}
