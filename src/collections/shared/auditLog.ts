import type { Payload } from 'payload'

type WriteAuditLogInput = {
  action: string
  actor?: number | null
  targetCollection: string
  targetId: string | number
  municipality?: number | null
  metadata?: Record<string, unknown>
}

/** Fire-and-forget audit entry — a failed log write must never block the operation it's logging. */
export const writeAuditLog = (payload: Payload, input: WriteAuditLogInput): void => {
  payload
    .create({
      collection: 'audit-log',
      data: {
        action: input.action,
        actor: input.actor ?? undefined,
        targetCollection: input.targetCollection,
        targetId: String(input.targetId),
        municipality: input.municipality ?? undefined,
        metadata: input.metadata,
      },
      overrideAccess: true,
    })
    .catch((error) => payload.logger.error({ err: error, action: input.action }, 'Failed to write audit log entry'))
}
