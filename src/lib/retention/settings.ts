import type { Payload } from 'payload'

import { RETENTION } from './policy'

/**
 * The retention periods as the platform set them (RetentionSettings, superadmin → Compliance) over
 * the defaults in RETENTION — so a change of law means changing a number there, not a deploy. Each
 * period has a floor nobody goes under: the audit log and its write-once copy the 18 months of
 * vyhláška č. 409/2025 Sb. § 22 odst. 5 písm. c (the database refuses the log anyway — trigger
 * audit_log_guard), the rest a day / a month so a slip can't empty a collection.
 */

export type Retention = { -readonly [K in keyof typeof RETENTION]: number }

/** What the superadmin may change, with its unit, floor and why it is what it is. */
export const EDITABLE_RETENTION = {
  auditLogMonths: {
    label: 'Audit log v aplikaci',
    unit: 'měsíců',
    min: RETENTION.auditLogMinimumMonths,
    basis:
      'Min. 18 měsíců (vyhláška 409/2025 Sb. § 22 odst. 5 písm. c); 36 = obecná promlčecí lhůta (OZ § 629). Déle ne — GDPR čl. 5 odst. 1 písm. e.',
  },
  auditExportMonths: {
    label: 'Neměnná kopie audit logu (úložiště)',
    unit: 'měsíců',
    min: RETENTION.auditLogMinimumMonths,
    basis:
      'Uzamčení noční kopie mimo aplikaci — min. 18 měsíců (vyhláška 409/2025 Sb. § 22 odst. 5 písm. c).',
  },
  securityEventMonths: {
    label: 'Bezpečnostní události (přihlášení, limity)',
    unit: 'měsíců',
    min: 1,
    basis: 'Rok ukáže vzorec přes sezóny; jejich kopie zůstává v neměnném úložišti.',
  },
  systemLogDays: {
    label: 'Systémové logy (diagnostika)',
    unit: 'dní',
    min: 1,
    basis: 'Provozní potřeba.',
  },
  importRunDays: {
    label: 'Běhy importu akcí',
    unit: 'dní',
    min: 1,
    basis: 'Provozní potřeba (podpora, kontrola zdrojů).',
  },
  notificationDays: {
    label: 'Oznámení v aplikaci',
    unit: 'dní',
    min: 1,
    basis: 'Minimalizace údajů (GDPR čl. 5 odst. 1 písm. c, e).',
  },
  notificationReadDays: {
    label: 'Přečtená oznámení',
    unit: 'dní',
    min: 1,
    basis: 'Minimalizace údajů (GDPR čl. 5 odst. 1 písm. c, e).',
  },
  decidedRequestDays: {
    label: 'Vyřízené žádosti a pozvánky',
    unit: 'dní',
    min: 1,
    basis: 'Po začátku akce už nejsou potřeba.',
  },
  organizerRequestMonths: {
    label: 'Vyřízené žádosti o roli pořadatele',
    unit: 'měsíců',
    min: 1,
    basis: 'Žadatel vidí výsledek v profilu.',
  },
} as const satisfies Partial<
  Record<keyof Retention, { label: string; unit: string; min: number; basis: string }>
>

export type EditableRetentionKey = keyof typeof EDITABLE_RETENTION

export const EDITABLE_RETENTION_KEYS = Object.keys(EDITABLE_RETENTION) as EditableRetentionKey[]

/** The stored settings over the defaults, never under a floor. */
export function retentionFrom(
  stored: Partial<Record<string, unknown>> | null | undefined,
): Retention {
  const retention: Retention = { ...RETENTION }
  for (const key of EDITABLE_RETENTION_KEYS) {
    const value = stored?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      retention[key] = Math.max(EDITABLE_RETENTION[key].min, Math.round(value))
    }
  }
  return retention
}

export async function getRetention(payload: Payload): Promise<Retention> {
  const stored = await payload
    .findGlobal({ slug: 'retention-settings', depth: 0, overrideAccess: true })
    .catch(() => null)
  return retentionFrom(stored as Partial<Record<string, unknown>> | null)
}
