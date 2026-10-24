import type { GlobalConfig } from 'payload'

const platformAdmin = ({ req }: { req: { user?: { role?: string | null } | null } }) =>
  req.user?.role === 'admin'

/**
 * The platform's switches for importing events (docs/import-akci-z-webu.md) — kept by its admins in
 * the superadmin panel. `aiEnabled` off stops every AI read at once (a provider incident, costs out
 * of hand): sources go on with iCal and schema.org, which cost nothing.
 */
export const ImportSettings: GlobalConfig = {
  slug: 'import-settings',
  access: { read: platformAdmin, update: platformAdmin },
  fields: [{ name: 'aiEnabled', type: 'checkbox', defaultValue: true }],
}
