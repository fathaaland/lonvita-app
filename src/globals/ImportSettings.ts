import type { GlobalAfterChangeHook, GlobalConfig } from 'payload'

import { writeAuditLog } from '@/collections/shared/auditLog'

const platformAdmin = ({ req }: { req: { user?: { role?: string | null } | null } }) =>
  req.user?.role === 'admin'

/** A change of the import switches is a change of the platform's settings — on the record. */
const auditChange: GlobalAfterChangeHook = ({ doc, previousDoc, req }) => {
  if (!req.user) return doc
  writeAuditLog(req.payload, {
    action: 'import-settings.update',
    actor: Number(req.user.id),
    targetCollection: 'import-settings',
    targetId: 'global',
    metadata: {
      before: { aiEnabled: previousDoc?.aiEnabled ?? null },
      after: { aiEnabled: doc?.aiEnabled ?? null },
    },
    source: req,
  })
  return doc
}

/**
 * The platform's switches for importing events (docs/import-akci-z-webu.md) — kept by its admins in
 * the superadmin panel. `aiEnabled` off stops every AI read at once (a provider incident, costs out
 * of hand): sources go on with iCal and schema.org, which cost nothing.
 */
export const ImportSettings: GlobalConfig = {
  slug: 'import-settings',
  access: { read: platformAdmin, update: platformAdmin },
  hooks: { afterChange: [auditChange] },
  fields: [{ name: 'aiEnabled', type: 'checkbox', defaultValue: true }],
}
