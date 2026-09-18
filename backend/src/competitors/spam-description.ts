/** A private invite link: t.me/+abc or the older t.me/joinchat/abc. */
const INVITE_LINK = /(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)[\w-]+/gi;

/** Wording of "exclusive closed channel" funnels; harmless alone, telling next to an invite link. */
const BAIT = /закрыт|приватн|впуска|резерв|успей|осталось\s+\d*\s*мест|до\s+\d+\s+человек/i;

/**
 * Funnel channels exist to push readers into a private channel, so their
 * description is little more than invite links and urgency. One invite link on
 * its own is common in real channels (usually their discussion chat), so it
 * only counts together with bait wording; two or more are a funnel either way.
 */
export function looksLikeSpam(description: string | null): boolean {
  if (!description) return false;
  const inviteLinks = description.match(INVITE_LINK)?.length ?? 0;
  if (inviteLinks >= 2) return true;
  return inviteLinks === 1 && BAIT.test(description);
}
