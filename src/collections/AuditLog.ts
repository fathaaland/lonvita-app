import type { CollectionBeforeOperationHook, CollectionConfig } from 'payload'

import { recordAuditLog } from './shared/auditLog'

/** Looking into the audit log is itself on the record (vyhláška č. 409/2025 Sb. § 22 odst. 3 písm. g)
 * — every read through the API or the admin panel, by whom and from where. Server-side reads
 * (overrideAccess) are the app's own and aren't. Awaited, but a failed write doesn't lock the
 * platform admin out of the log. */
const recordRead: CollectionBeforeOperationHook = async ({ args, operation, req }) => {
  if (operation !== 'read' || args.overrideAccess !== false || !req.user) return args
  const { id } = args as { id?: number | string }
  await recordAuditLog(req.payload, {
    action: 'audit-log.read',
    actor: Number(req.user.id),
    targetCollection: 'audit-log',
    targetId: id ?? 'list',
    source: req,
  }).catch((error) => req.payload.logger.error({ err: error }, 'Failed to record an audit log read'))
  return args
}

export const AuditLog: CollectionConfig = {
  slug: 'audit-log',
  labels: {
    singular: 'Audit Log Entry',
    plural: 'Audit Log',
  },
  admin: {
    useAsTitle: 'action',
    defaultColumns: ['action', 'outcome', 'actor', 'targetCollection', 'targetId', 'createdAt'],
    description:
      'Append-only — the database itself refuses edits and any delete younger than 18 months (trigger audit_log_guard). Kept 36 months, then removed by the nightly data-retention job, which writes down everything it removes here first. Reading it is recorded too.',
  },
  access: {
    // Written exclusively via `overrideAccess: true` from collection hooks — never
    // reachable through the public API, so this stays a true system-only log.
    create: () => false,
    read: ({ req: { user } }) => user?.role === 'admin',
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'action',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'e.g. "user-roles.grant", "consents.revoke", "data-retention.purge".',
      },
    },
    {
      name: 'outcome',
      type: 'select',
      required: true,
      defaultValue: 'success',
      options: [
        { label: 'Success', value: 'success' },
        { label: 'Failure (refused)', value: 'failure' },
      ],
    },
    {
      name: 'actor',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        description: 'Who performed the action. Empty for system-triggered entries.',
      },
    },
    {
      name: 'targetCollection',
      type: 'text',
      required: true,
    },
    {
      name: 'targetId',
      type: 'text',
      required: true,
    },
    {
      name: 'municipality',
      type: 'relationship',
      relationTo: 'municipalities',
    },
    {
      name: 'metadata',
      type: 'json',
    },
    {
      name: 'ipAddress',
      type: 'text',
      admin: { description: "The originator's address. Empty for system-triggered entries.", position: 'sidebar' },
    },
    {
      name: 'userAgent',
      type: 'text',
      admin: { description: "The originator's browser.", position: 'sidebar' },
    },
    {
      name: 'correlationId',
      type: 'text',
      admin: { description: 'The request id — the same one in System Logs and Security Events.', position: 'sidebar' },
    },
  ],
  hooks: {
    beforeOperation: [recordRead],
  },
  timestamps: true,
}
