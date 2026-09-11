/**
 * How far back a sync scrapes posts. A newly added account's first sync therefore
 * reaches this many days before the account was added, which is also where the
 * account page says post data begins.
 */
export const POST_HISTORY_DAYS = 90;
