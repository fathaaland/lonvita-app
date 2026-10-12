import type { CollectionBeforeChangeHook } from 'payload'
import { APIError } from 'payload'

import { canCancelEvent, EVENT_CANCELLATION_CUTOFF_HOURS } from '@/lib/eventCancellation'

/**
 * Cancelling is one state, written both ways: `deletedAt` (what takes the event out of every listing
 * and tells the registrants, Events notifyRegistrantsOnCancellation) and status "cancelled". Asking
 * for either sets the other, so a status-only PATCH can't leave a "cancelled" event up and
 * unannounced. And it's final — nobody brings a cancelled event back: its registrants have been told.
 */
export const sealCancellation: CollectionBeforeChangeHook = ({ data, originalDoc, operation, req }) => {
  if (operation !== 'update' || !data || !originalDoc) return data

  // Trusted internal writes (no user — seeds, scripts) pass as always.
  if (originalDoc.deletedAt || originalDoc.status === 'cancelled') {
    if (!req.user) return data
    const reviving =
      ('deletedAt' in data && !data.deletedAt) || (data.status !== undefined && data.status !== 'cancelled')
    if (reviving) throw new APIError('Zrušenou akci už obnovit nejde — přihlášení se o zrušení dozvěděli.', 400)
    return data
  }

  if (data.deletedAt || data.status === 'cancelled') {
    data.deletedAt = data.deletedAt || new Date().toISOString()
    data.status = 'cancelled'
  }
  return data
}

/**
 * Cancelling an event — the soft-delete PATCH that sets `deletedAt` / status "cancelled" (see
 * deleteEvent in admin-queries.ts) — is only allowed until EVENT_CANCELLATION_CUTOFF_HOURS before
 * it starts. Enforced here rather than only by hiding the button, so a direct API call can't
 * cancel an event people are already on their way to.
 */
export const guardCancellationWindow: CollectionBeforeChangeHook = ({ data, originalDoc, operation }) => {
  if (operation !== 'update' || !data || !originalDoc) return data

  const cancelling =
    (data.deletedAt && !originalDoc.deletedAt) || (data.status === 'cancelled' && originalDoc.status !== 'cancelled')
  if (!cancelling) return data

  if (!canCancelEvent(originalDoc.dateTime)) {
    throw new APIError(
      `Akci lze zrušit nejpozději ${EVENT_CANCELLATION_CUTOFF_HOURS} hodiny před jejím začátkem.`,
      400,
    )
  }

  return data
}
