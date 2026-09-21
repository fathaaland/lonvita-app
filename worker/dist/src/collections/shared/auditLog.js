/** Fire-and-forget audit entry — a failed log write must never block the operation it's logging. */
export const writeAuditLog = (payload, input) => {
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
        .catch((error) => payload.logger.error({ err: error, action: input.action }, 'Failed to write audit log entry'));
};
