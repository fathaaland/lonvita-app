import type { CollectionConfig } from 'payload'

/**
 * An obec outgrowing the licence band it pays for, within a licence year (lib/billing/licence-tier): it
 * moves up from `effectiveFrom` (the month after it was found), and owes the price difference for the
 * months of the year still to come — never back. What the platform invoices from. Written by the daily
 * billing job alone; read by the platform alone — no one changes or deletes the record through the API.
 */
export const LicenceUpgrades: CollectionConfig = {
  slug: 'licence-upgrades',
  labels: { singular: 'Licence Upgrade', plural: 'Licence Upgrades' },
  admin: {
    useAsTitle: 'periodKey',
    defaultColumns: ['municipality', 'fromTier', 'toTier', 'effectiveFrom', 'surchargeCzk'],
  },
  defaultSort: '-createdAt',
  access: {
    read: ({ req: { user } }) => user?.role === 'admin',
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'municipality', type: 'relationship', relationTo: 'municipalities', required: true, index: true },
    // The licence year it falls in (LicencePeriod.key).
    { name: 'periodKey', type: 'text', required: true },
    { name: 'fromTier', type: 'number', required: true, min: 0 },
    { name: 'toTier', type: 'number', required: true, min: 0 },
    // The average of the last three snapshots that put it there.
    { name: 'averageUsers', type: 'number', required: true, min: 0 },
    { name: 'effectiveFrom', type: 'date', required: true },
    { name: 'monthsCharged', type: 'number', required: true, min: 0 },
    { name: 'periodMonths', type: 'number', required: true, min: 1 },
    { name: 'fromYearlyCzk', type: 'number', required: true, min: 0 },
    { name: 'toYearlyCzk', type: 'number', required: true, min: 0 },
    // (toYearlyCzk − fromYearlyCzk) × monthsCharged / periodMonths, rounded to the crown.
    { name: 'surchargeCzk', type: 'number', required: true, min: 0 },
  ],
  timestamps: true,
}
