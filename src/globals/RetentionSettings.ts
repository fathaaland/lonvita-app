import type { Field, GlobalAfterChangeHook, GlobalConfig } from 'payload'

import { writeAuditLog } from '@/collections/shared/auditLog'
import { RETENTION } from '@/lib/retention/policy'
import { EDITABLE_RETENTION, EDITABLE_RETENTION_KEYS } from '@/lib/retention/settings'

const platformAdmin = ({ req }: { req: { user?: { role?: string | null } | null } }) =>
  req.user?.role === 'admin'

/** Changing how long logs are kept is itself on the record — vyhláška 409/2025 Sb. § 22 asks for
 * changes of the logging settings to be logged. */
const auditChange: GlobalAfterChangeHook = ({ doc, previousDoc, req }) => {
  if (!req.user) return doc
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const key of EDITABLE_RETENTION_KEYS) {
    const from = previousDoc?.[key] ?? null
    const to = doc[key] ?? null
    if (from !== to) changes[key] = { from, to }
  }
  if (Object.keys(changes).length === 0) return doc
  writeAuditLog(req.payload, {
    action: 'retention-settings.update',
    actor: Number(req.user.id),
    targetCollection: 'retention-settings',
    targetId: 'global',
    metadata: { changes },
    source: req,
  })
  return doc
}

/**
 * How long Lonvita keeps what (lib/retention/settings) — set by the platform's admins in the
 * superadmin panel (Compliance), each period never under its legal or technical floor. Empty: the
 * default in RETENTION.
 */
export const RetentionSettings: GlobalConfig = {
  slug: 'retention-settings',
  access: { read: platformAdmin, update: platformAdmin },
  hooks: { afterChange: [auditChange] },
  fields: EDITABLE_RETENTION_KEYS.map(
    (key): Field => ({
      name: key,
      type: 'number',
      min: EDITABLE_RETENTION[key].min,
      admin: {
        description: `${EDITABLE_RETENTION[key].basis} Výchozí: ${RETENTION[key]} ${EDITABLE_RETENTION[key].unit}.`,
      },
    }),
  ),
}
