import type { CollectionBeforeChangeHook } from 'payload'
import { APIError } from 'payload'

import { canCancelEvent, EVENT_CANCELLATION_CUTOFF_HOURS } from '@/lib/eventCancellation'

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
