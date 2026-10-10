/** What someone types to confirm deleting their account — checked by POST /api/account/delete and
 * asked for by the profile's "Smazat účet" dialog. */
export const ACCOUNT_DELETION_CONFIRMATION = 'SMAZAT';

/** An obec whose only admin is the one about to delete their account — it would be left with nobody
 * to decide its requests, so the account waits until the platform admin appoints another. */
export type AccountDeletionSoleAdminObec = { id: string; name: string };

/** An event that keeps an organizer from deleting their account — they run or co-organize it and it
 * hasn't taken place yet (shared/anonymizeUser). */
export type AccountDeletionBlockingEvent = { id: string; title: string; date_time: string };
