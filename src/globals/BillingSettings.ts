import type { Field, GlobalAfterChangeHook, GlobalConfig } from 'payload'

import { writeAuditLog } from '@/collections/shared/auditLog'
import { DEFAULT_CATALOG, PACKAGE_KEYS } from '@/lib/billing/catalog'

const platformAdmin = ({ req }: { req: { user?: { role?: string | null } | null } }) =>
  req.user?.role === 'admin'

const amount = (name: string, defaultValue: number, max?: number): Field => ({
  name,
  type: 'number',
  min: 0,
  ...(max !== undefined ? { max } : {}),
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
 * The price list the platform sells obce from (lib/billing/catalog) — licence bands by inhabitants with
 * their floors and implementation fees, the growth band and discounts, the SMS and scraping packages,
 * one-off fees and the technical limit on a scraping run. Kept by the platform's
 * admins in the superadmin panel (Ceník balíčků). Never shown to an obec — it sees its own package
 * and how much of it it used.
 */
export const BillingSettings: GlobalConfig = {
  slug: 'billing-settings',
  access: { read: platformAdmin, update: platformAdmin },
  hooks: { afterChange: [auditChange] },
  fields: [
    {
      // Bands by inhabitants (Ceník 2027), in order, the open-ended one last.
      name: 'licenceTiers',
      type: 'array',
      minRows: 1,
      defaultValue: DEFAULT_CATALOG.licenceTiers,
      fields: [
        // Empty on the last band — "a víc".
        { name: 'maxPopulation', type: 'number', min: 0 },
        // Empty — individual (the contract's price).
        { name: 'yearlyPriceCzk', type: 'number', min: 0 },
        // Not required in the database: rows of the old price list (by users) have neither — they're
        // ignored (catalogFrom), and adding a NOT NULL column to a table with rows would fail.
        { name: 'floorCzk', type: 'number', min: 0 },
        { name: 'implementationFeeCzk', type: 'number', min: 0 },
        // The price list before 1. 11. 2026 (bands by users) — unused; dropped by a later migration.
        { name: 'maxUsers', type: 'number', min: 0, admin: { hidden: true } },
      ],
    },
    amount('activeUsersIncludedPercent', DEFAULT_CATALOG.activeUsersIncludedPercent, 100),
    amount('growthCapCzk', DEFAULT_CATALOG.growthCapCzk),
    amount('threeYearDiscountPercent', DEFAULT_CATALOG.threeYearDiscountPercent, 50),
    amount('referenceImplementationDiscountPercent', DEFAULT_CATALOG.referenceImplementationDiscountPercent, 100),
    packageGroup('smsPackages', (key) => [
      amount('quota', DEFAULT_CATALOG.smsPackages[key].quota),
      amount('yearlyPriceCzk', DEFAULT_CATALOG.smsPackages[key].yearlyPriceCzk),
    ]),
    amount('smsOveragePriceCzk', DEFAULT_CATALOG.smsOveragePriceCzk),
    // 0 = no overage at all; the rest of the cap is in lib/billing/sms smsHardLimitOf.
    amount('smsOverageCapPercent', DEFAULT_CATALOG.smsOverageCapPercent, 200),
    packageGroup('scrapingPackages', (key) => [
      amount('maxSources', DEFAULT_CATALOG.scrapingPackages[key].maxSources),
      amount('yearlyPriceCzk', DEFAULT_CATALOG.scrapingPackages[key].yearlyPriceCzk),
    ]),
    amount('sourceSetupFeeCzk', DEFAULT_CATALOG.sourceSetupFeeCzk),
    amount('maxInputTokensPerRun', DEFAULT_CATALOG.maxInputTokensPerRun),
    amount('scrapingCostAlertUsdPerSource', DEFAULT_CATALOG.scrapingCostAlertUsdPerSource),
    // No longer sold (Ceník 2027) — unused; dropped by a later migration (code first, migration second).
    { name: 'implementationFeeCzk', type: 'number', min: 0, admin: { hidden: true } },
    { name: 'scrapingExtraSourcePriceCzk', type: 'number', min: 0, admin: { hidden: true } },
    { name: 'scrapingTwiceWeeklyPriceCzk', type: 'number', min: 0, admin: { hidden: true } },
  ],
}
