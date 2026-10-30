import type { Payload } from 'payload'

import type { Municipality } from '@/payload-types'
import { aiBudgetOf, pragueMonthStart } from '@/lib/import/usage'
import { getCostByMunicipality } from '@/lib/usage/dashboard-aggregation'

/**
 * What an obec pays us for, and what it has used of it this month. Every obec gets e-mails; SMS and
 * the AI import only when it pays for them (Municipalities.smsEnabled / importAiEnabled). Each
 * service is a flat monthly price in Kč the platform sets — what the obec uses never changes what it
 * pays: the SMS count and the share of the AI limit are there so it sees how close to the limit it is.
 */

type ServiceFields = Pick<
  Municipality,
  | 'emailPriceCzk'
  | 'smsEnabled'
  | 'smsPriceCzk'
  | 'smsMonthlyLimit'
  | 'importAiEnabled'
  | 'importAiPriceCzk'
  | 'importAiBudgetUsd'
>

export type MunicipalityServices = {
  email: { enabled: true; priceCzk: number | null }
  sms: {
    enabled: boolean
    priceCzk: number | null
    sentThisMonth: number
    monthlyLimit: number | null
  }
  importAi: { enabled: boolean; priceCzk: number | null; usedPercent: number }
  /** The prices of what it has switched on, together — a month. */
  monthlyTotalCzk: number
}

/** The platform's own view on top — what the AI actually cost us, in USD. Never shown to the obec. */
export type MunicipalityServicesWithCosts = MunicipalityServices & {
  importAi: MunicipalityServices['importAi'] & { spentUsd: number; budgetUsd: number }
}

const findServiceFields = async (
  payload: Payload,
  municipalityId: number,
): Promise<ServiceFields> =>
  payload.findByID({
    collection: 'municipalities',
    id: municipalityId,
    depth: 0,
    overrideAccess: true,
    select: {
      emailPriceCzk: true,
      smsEnabled: true,
      smsPriceCzk: true,
      smsMonthlyLimit: true,
      importAiEnabled: true,
      importAiPriceCzk: true,
      importAiBudgetUsd: true,
    },
  })

export async function countSmsThisMonth(
  payload: Payload,
  municipalityId: number,
  now: Date,
): Promise<number> {
  const { totalDocs } = await payload.count({
    collection: 'sms-messages',
    where: {
      and: [
        { municipality: { equals: municipalityId } },
        { createdAt: { greater_than_equal: pragueMonthStart(now).toISOString() } },
      ],
    },
    overrideAccess: true,
  })
  return totalDocs
}

/** How many more SMS the obec may send this month — 0 without the service, null when uncapped. */
export async function smsAllowanceOf(
  payload: Payload,
  municipalityId: number,
  now: Date,
): Promise<number | null> {
  const fields = await findServiceFields(payload, municipalityId)
  if (!fields.smsEnabled) return 0
  if (fields.smsMonthlyLimit == null) return null
  return Math.max(
    0,
    fields.smsMonthlyLimit - (await countSmsThisMonth(payload, municipalityId, now)),
  )
}

export async function getMunicipalityServices(
  payload: Payload,
  municipalityId: number,
  now: Date,
): Promise<MunicipalityServicesWithCosts> {
  const [fields, sentThisMonth, costs] = await Promise.all([
    findServiceFields(payload, municipalityId),
    countSmsThisMonth(payload, municipalityId, now),
    getCostByMunicipality(payload, {
      from: pragueMonthStart(now),
      to: new Date(now.getTime() + 1),
      municipalityId,
    }),
  ])
  const smsEnabled = fields.smsEnabled === true
  const importAiEnabled = fields.importAiEnabled === true
  const spentUsd = costs.get(municipalityId) ?? 0
  const budgetUsd = aiBudgetOf(fields)
  return {
    email: { enabled: true, priceCzk: fields.emailPriceCzk ?? null },
    sms: {
      enabled: smsEnabled,
      priceCzk: fields.smsPriceCzk ?? null,
      sentThisMonth,
      monthlyLimit: fields.smsMonthlyLimit ?? null,
    },
    importAi: {
      enabled: importAiEnabled,
      priceCzk: fields.importAiPriceCzk ?? null,
      usedPercent: budgetUsd > 0 ? Math.min(100, Math.round((spentUsd / budgetUsd) * 100)) : 0,
      spentUsd,
      budgetUsd,
    },
    monthlyTotalCzk:
      (fields.emailPriceCzk ?? 0) +
      (smsEnabled ? (fields.smsPriceCzk ?? 0) : 0) +
      (importAiEnabled ? (fields.importAiPriceCzk ?? 0) : 0),
  }
}

/** The obec's view — without what anything costs us. */
export const withoutCosts = ({
  importAi,
  ...rest
}: MunicipalityServicesWithCosts): MunicipalityServices => ({
  ...rest,
  importAi: {
    enabled: importAi.enabled,
    priceCzk: importAi.priceCzk,
    usedPercent: importAi.usedPercent,
  },
})
