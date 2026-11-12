import type { Field, GlobalAfterChangeHook, GlobalConfig } from 'payload'

import { writeAuditLog } from '@/collections/shared/auditLog'
import { DEFAULT_CATALOG, PACKAGE_KEYS } from '@/lib/billing/catalog'

const platformAdmin = ({ req }: { req: { user?: { role?: string | null } | null } }) =>
  req.user?.role === 'admin'

const amount = (name: string, defaultValue: number): Field => ({
  name,
  type: 'number',
  min: 0,
  required: true,
  defaultValue,
})

const withoutMeta = (doc: Record<string, unknown> | undefined) => {
  if (!doc) return null
  const { id: _id, updatedAt: _u, createdAt: _c, globalType: _g, ...rest } = doc
  return rest
}

/** Every change of the price list is on the record — who, when, from what to what. */
const auditChange: GlobalAfterChangeHook = ({ doc, previousDoc, req }) => {
  if (!req.user) return doc
  writeAuditLog(req.payload, {
    action: 'billing-settings.update',
    actor: Number(req.user.id),
    targetCollection: 'billing-settings',
    targetId: 'global',
    metadata: { before: withoutMeta(previousDoc), after: withoutMeta(doc) },
    source: req,
  })
  return doc
}

const packageGroup = (
  name: 'smsPackages' | 'scrapingPackages',
  fieldsOf: (key: (typeof PACKAGE_KEYS)[number]) => Field[],
): Field => ({
  name,
  type: 'group',
  fields: PACKAGE_KEYS.map((key): Field => ({ name: key, type: 'group', fields: fieldsOf(key) })),
})

/**
 * The price list the platform sells obce from (lib/billing/catalog) — licence bands, the SMS and
 * scraping packages, one-off fees and the technical limit on a scraping run. Kept by the platform's
 * admins in the superadmin panel (Ceník balíčků). Never shown to an obec — it sees its own package
 * and how much of it it used.
 */
export const BillingSettings: GlobalConfig = {
  slug: 'billing-settings',
  access: { read: platformAdmin, update: platformAdmin },
  hooks: { afterChange: [auditChange] },
  fields: [
    {
      name: 'licenceTiers',
      type: 'array',
      minRows: 1,
      defaultValue: DEFAULT_CATALOG.licenceTiers,
      fields: [
        // Empty on the last band — "a víc".
        { name: 'maxUsers', type: 'number', min: 0 },
        amount('yearlyPriceCzk', 0),
      ],
    },
    amount('implementationFeeCzk', DEFAULT_CATALOG.implementationFeeCzk),
    packageGroup('smsPackages', (key) => [
      amount('quota', DEFAULT_CATALOG.smsPackages[key].quota),
      amount('yearlyPriceCzk', DEFAULT_CATALOG.smsPackages[key].yearlyPriceCzk),
    ]),
    amount('smsOveragePriceCzk', DEFAULT_CATALOG.smsOveragePriceCzk),
    packageGroup('scrapingPackages', (key) => [
      amount('maxSources', DEFAULT_CATALOG.scrapingPackages[key].maxSources),
      amount('yearlyPriceCzk', DEFAULT_CATALOG.scrapingPackages[key].yearlyPriceCzk),
    ]),
    amount('sourceSetupFeeCzk', DEFAULT_CATALOG.sourceSetupFeeCzk),
    amount('scrapingExtraSourcePriceCzk', DEFAULT_CATALOG.scrapingExtraSourcePriceCzk),
    amount('scrapingTwiceWeeklyPriceCzk', DEFAULT_CATALOG.scrapingTwiceWeeklyPriceCzk),
    amount('maxInputTokensPerRun', DEFAULT_CATALOG.maxInputTokensPerRun),
    amount('scrapingCostAlertUsdPerSource', DEFAULT_CATALOG.scrapingCostAlertUsdPerSource),
  ],
}
