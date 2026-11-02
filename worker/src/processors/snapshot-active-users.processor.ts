import { takeActiveUserSnapshot } from '@/lib/billing/active-users'
import { logger, serializeError } from '@/lib/logger'

import { getWorkerPayload } from '../runtime/payload'

import type { SnapshotActiveUsersJobResult } from '@/lib/queue/contracts'

/**
 * On the 1st of every month: each obec's users counted and kept as that month's snapshot — what its
 * licence band is worked out from (the average of the last three). One obec failing doesn't stop
 * the others; the superadmin can take any of them again by hand.
 */
export const processSnapshotActiveUsersJob = async (now: Date = new Date()): Promise<SnapshotActiveUsersJobResult> => {
  const payload = await getWorkerPayload()
  const municipalities = await payload.find({
    collection: 'municipalities',
    select: {},
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  let snapshots = 0
  let failed = 0
  for (const m of municipalities.docs) {
    try {
      await takeActiveUserSnapshot(payload, m.id, now)
      snapshots++
    } catch (error) {
      failed++
      logger.error('Active user snapshot failed', {
        event: 'billing.snapshot_failed',
        municipalityId: m.id,
        ...serializeError(error),
      })
    }
  }
  logger.info('Active user snapshots taken', { event: 'billing.snapshots_taken', snapshots, failed })
  return { snapshots, failed }
}
