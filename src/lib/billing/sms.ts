import { sql } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'

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

/**
 * The one SMS Lonvita sends (decided 12. 11. 2026): "akce byla zrušena", to the registrants of a
 * cancelled event — never for a change, a reminder or anything else. Every SMS's request id starts
 * with this, and the worker sends nothing else (sms.processor), whoever queued it.
 */
export const CANCELLATION_SMS_PREFIX = 'event-cancelled-'

export const isCancellationSmsRequest = (requestId: string | undefined): requestId is string =>
  typeof requestId === 'string' && requestId.startsWith(CANCELLATION_SMS_PREFIX)

/** The announcement an SMS belongs to — its request id is `<announcement>-<userId>`. */
export const announcementOfSms = (requestId: string): string => requestId.replace(/-[^-]+$/, '')

/** Links and web addresses — a title typed by the pořadatel must not travel as a link in an SMS sent
 * from Lonvita's own sender. */
const LINKS =
  /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:cz|sk|com|net|org|eu|info|io|me|app|link|ly|to|gl|co|online|site|xyz|biz|de|at|pl|ru|ua|shop|club|top)\b(?:\/\S*)?/gi

const PREFIX = 'Lonvita: akce "'
const SUFFIX = '" byla zrusena.'

/** "Lonvita: akce „…“ byla zrušena." — without diacritics or links, the title cut so the whole SMS is
 * always one part, whatever the pořadatel named the event. */
export function cancellationSmsText(title: string): string {
  const clean = toSmsText(title).replace(LINKS, ' ').replace(/["\n]/g, ' ').replace(/\s+/g, ' ').trim() || 'bez nazvu'
  const room = 160 - PREFIX.length - SUFFIX.length
  const cut = clean.length > room ? `${clean.slice(0, room - 3).trimEnd()}...` : clean
  return `${PREFIX}${cut}${SUFFIX}`
}

type SmsFields = Pick<
  Municipality,
  | 'smsEnabled'
  | 'billingStatus'
  | 'smsPackage'
  | 'smsQuotaOverride'
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
  /** Inside a transaction: counted on its connection (a second one per caller runs the pool dry). */
  req?: PayloadRequest,
  /** Leave out the SMS of this announcement — what the others used before it. */
  exceptAnnouncement?: string,
): Promise<{ parts: number; overageParts: number; messages: number }> {
  const db = payload.db as unknown as {
    drizzle: Payload['db']['drizzle']
    sessions?: Record<string, { db?: Payload['db']['drizzle'] }>
  }
  const session = req?.transactionID ? db.sessions?.[String(await req.transactionID)]?.db : undefined
  // Summed in the database: an obec's year of SMS is thousands of rows, and this runs for every SMS
  // sent (the quota alerts) and every announcement deciding who gets one.
  const { rows } = await (session ?? db.drizzle).execute<{ parts: string | null; overage_parts: string | null; messages: string }>(sql`
    SELECT
      COALESCE(SUM(COALESCE(parts, 1)), 0) AS parts,
      COALESCE(SUM(COALESCE(parts, 1)) FILTER (WHERE overage), 0) AS overage_parts,
      COUNT(*) AS messages
    FROM sms_messages
    WHERE municipality_id = ${municipalityId}
      AND created_at >= ${from.toISOString()}
      AND created_at < ${to.toISOString()}
      ${exceptAnnouncement ? sql`AND (request_id IS NULL OR request_id NOT LIKE ${`${exceptAnnouncement.replace(/[\\%_]/g, '\\$&')}-%`})` : sql``}
  `)
  const row = rows[0]
  return {
    parts: Number(row?.parts ?? 0),
    overageParts: Number(row?.overage_parts ?? 0),
    messages: Number(row?.messages ?? 0),
  }
}

export type SmsUsage = {
  enabled: boolean
  suspended: boolean
  quota: number
  usedParts: number
  overageParts: number
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
    period,
  }
}

export type SmsAllowance = {
  /** The obec has SMS and isn't suspended — without, nobody is texted and nothing is "withheld". */
  active: boolean
  quota: number
  remainingParts: number
}

/**
 * What the obec may still text — parts left in its quota. Nothing for an obec without SMS, or one
 * suspended for not paying: its people hear it by e-mail and in-app.
 */
export async function smsAllowanceOf(
  payload: Payload,
  municipalityId: number,
  now: Date,
): Promise<SmsAllowance> {
  const usage = await smsUsageOf(payload, municipalityId, now)
  if (!usage.enabled || usage.suspended) return { active: false, quota: usage.quota, remainingParts: 0 }
  return { active: true, quota: usage.quota, remainingParts: Math.max(0, usage.quota - usage.usedParts) }
}

/**
 * Who of `reachable` gets the cancellation SMS. A cancellation that starts while the obec has any part
 * left (after those held by SMS already queued) goes to everyone it concerns — those past the quota
 * marked as overage, billed by the contract's terms; once nothing is left, nobody. Then the obec is
 * blocked until its next licence year or a bigger package.
 */
export function planCancellationSms<R>(
  reachable: R[],
  parts: number,
  allowance: SmsAllowance,
  reservedParts: number,
): (R & { overage: boolean })[] {
  let left = allowance.active ? allowance.remainingParts - reservedParts : 0
  if (left <= 0) return []
  return reachable.map((r) => {
    left -= parts
    return { ...r, overage: left < 0 }
  })
}
