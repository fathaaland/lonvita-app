import type { Payload, PayloadRequest } from 'payload'

import { logger } from '@/lib/logger'
import { relationNumber } from '@/lib/relations'

/**
 * Whose use of an obec's package a ledger row (sms-messages, usage-events) is: the organization it
 * names — but only when that organization belongs to the obec the row is charged to. Everything is
 * charged to the obec of the event / source the work was done for, never to an organizer's own obec;
 * an organization of another obec (a neighbour in the mikroregion, a bug) is therefore never kept on
 * the row — it counts as nobody's and is logged. Each obec and its organizers use only that obec's
 * package.
 */
export async function organizationOfObec(
  payload: Payload,
  organizationId: number | null | undefined,
  municipalityId: number,
  req?: PayloadRequest,
): Promise<number | null> {
  if (!organizationId) return null
  const organization = await payload
    .findByID({ collection: 'organizations', id: organizationId, depth: 0, overrideAccess: true, select: { municipality: true }, req })
    .catch(() => null)
  if (organization && relationNumber(organization.municipality) === municipalityId) return organization.id
  if (organization) {
    logger.error('Usage attributed to an organization of another obec — dropped', {
      event: 'billing.attribution_foreign_organization',
      municipalityId,
      organizationId,
    })
  }
  return null
}
