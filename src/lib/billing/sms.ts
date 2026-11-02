import type { Payload } from 'payload'

import type { Municipality } from '@/payload-types'

import { getBillingCatalog, isPackageKey, type BillingCatalog } from './catalog'
import { licencePeriodOf, type LicencePeriod } from './period'

/**
 * SMS go out without diacritics (decided 2. 11. 2026): a part then holds 160 characters instead of
 * 70, so the same message costs a half to a third. Czech letters lose their marks, typographic
 * quotes and dashes become plain ones, and anything else the GSM alphabet can't carry becomes "?".
 */
export function toSmsText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[„“”″]/g, '"')
    .replace(/[‚‘’′]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7e\n]/g, '?')
}

/** How many parts a (diacritics-free) SMS goes out as — 160 characters alone, 153 each once split. */
export const smsPartsOf = (text: string): number =>
  text.length <= 160 ? 1 : Math.ceil(text.length / 153)

type SmsFields = Pick<
  Municipality,
  | 'smsEnabled'
  | 'billingStatus'
  | 'smsPackage'
  | 'smsQuotaOverride'
  | 'smsOverageAllowed'
  | 'licencePeriodStart'
  | 'licencePeriodEnd'
  | 'smsAlertState'
>

export const findSmsFields = (payload: Payload, municipalityId: number): Promise<SmsFields> =>
  payload.findByID({
    collection: 'municipalities',
    id: municipalityId,
    depth: 0,
    overrideAccess: true,
    select: {
      smsEnabled: true,
      billingStatus: true,
      smsPackage: true,
      smsQuotaOverride: true,
      smsOverageAllowed: true,
      licencePeriodStart: true,
      licencePeriodEnd: true,
      smsAlertState: true,
    },
  })

/** The yearly quota of SMS parts — the package's, or the one the superadmin set for the obec. */
export const smsQuotaOf = (
  fields: Pick<SmsFields, 'smsPackage' | 'smsQuotaOverride'>,
  catalog: BillingCatalog,
): number =>
  fields.smsQuotaOverride ??
  catalog.smsPackages[isPackageKey(fields.smsPackage) ? fields.smsPackage : 's'].quota

/** SMS parts the obec sent within [from, to) — `overageParts` those past its quota. */
export async function countSmsParts(
  payload: Payload,
  municipalityId: number,
  from: Date,
  to: Date,
): Promise<{ parts: number; overageParts: number; messages: number }> {
  const result = await payload.find({
    collection: 'sms-messages',
    where: {
      and: [
        { municipality: { equals: municipalityId } },
        { createdAt: { greater_than_equal: from.toISOString() } },
        { createdAt: { less_than: to.toISOString() } },
      ],
    },
    select: { parts: true, overage: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  let parts = 0
  let overageParts = 0
  for (const m of result.docs) {
    const n = m.parts ?? 1
    parts += n
    if (m.overage) overageParts += n
  }
  return { parts, overageParts, messages: result.docs.length }
}

export type SmsUsage = {
  enabled: boolean
  suspended: boolean
  quota: number
  usedParts: number
  overageParts: number
  overageAllowed: boolean
  period: LicencePeriod
}

export async function smsUsageOf(
  payload: Payload,
  municipalityId: number,
  now: Date,
  fields?: SmsFields,
  catalog?: BillingCatalog,
): Promise<SmsUsage> {
  const f = fields ?? (await findSmsFields(payload, municipalityId))
  const c = catalog ?? (await getBillingCatalog(payload))
  const period = licencePeriodOf(f, now)
  const used = await countSmsParts(payload, municipalityId, period.start, period.end)
  return {
    enabled: f.smsEnabled === true,
    suspended: f.billingStatus === 'suspended',
    quota: smsQuotaOf(f, c),
    usedParts: used.parts,
    overageParts: used.overageParts,
    overageAllowed: f.smsOverageAllowed === true,
    period,
  }
}

/**
 * What the obec may still text — parts left in its quota, and whether it may go past it. Nothing for
 * an obec without SMS, or one suspended for not paying: its people hear it by e-mail and in-app.
 */
export async function smsAllowanceOf(
  payload: Payload,
  municipalityId: number,
  now: Date,
): Promise<{ remainingParts: number; overageAllowed: boolean }> {
  const usage = await smsUsageOf(payload, municipalityId, now)
  if (!usage.enabled || usage.suspended) return { remainingParts: 0, overageAllowed: false }
  return {
    remainingParts: Math.max(0, usage.quota - usage.usedParts),
    overageAllowed: usage.overageAllowed,
  }
}
