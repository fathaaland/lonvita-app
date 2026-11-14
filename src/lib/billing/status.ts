/**
 * An obec that doesn't pay goes, step by step, from full service to read-only:
 *
 * - `active` — everything.
 * - `suspended` — the platform set it (unpaid after a reminder): SMS and import stop, the obec still
 *   runs its events. After SUSPENDED_GRACE_DAYS it becomes read-only by itself (worker billing-status);
 *   its admins are told WARN_DAYS_BEFORE ahead.
 * - `read_only` — SMS and import stay off, and nobody of the obec writes anything new: no event
 *   created or edited, no volunteers, organizers, co-organizers or sources taken on. What protects
 *   people keeps working — registering for and leaving its published events, the obec cancelling one
 *   (the registrants are told), attendance, everyone's own data. Lasts READ_ONLY_DAYS before the
 *   contract ends (terminated — not built yet).
 *
 * The platform can move an obec between them by hand at any time; `billingStatusChangedAt` is when
 * it last moved, the clock of both periods. Shared with the client — the server-side guard is in
 * collections/shared/readOnlyObec.
 */
export const BILLING_STATUSES = ['active', 'suspended', 'read_only'] as const
export type BillingStatus = (typeof BILLING_STATUSES)[number]

export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  active: 'Aktivní',
  suspended: 'Pozastaveno',
  read_only: 'Jen pro čtení',
}

export const SUSPENDED_GRACE_DAYS = 30
export const READ_ONLY_DAYS = 60
export const WARN_DAYS_BEFORE = 7

const DAY_MS = 24 * 60 * 60 * 1000

export const billingStatusOf = (value: unknown): BillingStatus =>
  (BILLING_STATUSES as readonly unknown[]).includes(value) ? (value as BillingStatus) : 'active'

/** SMS and import are off — the obec is suspended or further along. */
export const servicesHeld = (status: unknown): boolean => billingStatusOf(status) !== 'active'

export const isReadOnly = (status: unknown): boolean => billingStatusOf(status) === 'read_only'

/** When a suspended obec becomes read-only, or a read-only one's period ends. Null when active or
 * the clock was never started (set before the field existed — the worker starts it). */
export function nextBillingStepAt(status: unknown, changedAt: string | null | undefined): Date | null {
  if (!changedAt) return null
  const s = billingStatusOf(status)
  const days = s === 'suspended' ? SUSPENDED_GRACE_DAYS : s === 'read_only' ? READ_ONLY_DAYS : null
  return days === null ? null : new Date(new Date(changedAt).getTime() + days * DAY_MS)
}

export const READ_ONLY_MESSAGE =
  'Obec má kvůli nezaplacené licenci přístup jen pro čtení — nic nového teď založit ani upravit nejde. Přihlášky na zveřejněné akce a jejich rušení fungují dál. Obnovu licence vyřídí provozovatel Lonvity.'
