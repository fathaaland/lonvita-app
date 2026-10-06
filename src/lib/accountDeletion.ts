/** What someone types to confirm deleting their account — checked by POST /api/account/delete and
 * asked for by the profile's "Smazat účet" dialog. */
export const ACCOUNT_DELETION_CONFIRMATION = 'SMAZAT';

/** An event that keeps an organizer from deleting their account — they run or co-organize it and it
 * hasn't taken place yet (shared/anonymizeUser). */
export type AccountDeletionBlockingEvent = { id: string; title: string; date_time: string };
