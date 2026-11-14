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
 *   (the registrants are told), attendance, everyone's own data. After READ_ONLY_DAYS the contract
 *   ends by itself.
 * - `terminated` — the contract ended (the platform set it, or the read-only period ran out). Still
 *   read-only, and the obec downloads all its data (export municipality-archive). WARN_DAYS_BEFORE
 *   the end its events that would take place later are cancelled (the registrants told); after
 *   TERMINATED_DAYS everything of the obec is erased (Municipalities deleteMunicipalityData) — we
 *   process it for the obec, which is the controller (GDPR čl. 28(3)(g)) — and only once the platform
 *   has confirmed it by hand (erasureConfirmedStage; the job never erases on its own) — nothing of it is kept, not
 *   even anonymous statistics; only the audit log, kept by law. Its residents keep their accounts,
 *   "bez obce".
 *
 * The platform can move an obec between them by hand at any time until it's erased;
 * `billingStatusChangedAt` is when it last moved, the clock of every period. Shared with the client — the server-side guard is in
 * collections/shared/readOnlyObec.
 */
export const BILLING_STATUSES = ['active', 'suspended', 'read_only', 'terminated'] as const
export type BillingStatus = (typeof BILLING_STATUSES)[number]

export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  active: 'Aktivní',
  suspended: 'Pozastaveno',
  read_only: 'Jen pro čtení',
  terminated: 'Ukončeno',
}

export const SUSPENDED_GRACE_DAYS = 30
export const READ_ONLY_DAYS = 60
export const TERMINATED_DAYS = 90
/** Days after the licence's paid-until date before the obec is suspended by itself. */
export const LICENCE_GRACE_DAYS = 14
/** What a new obec gets to pay its first licence (Municipalities licencePaidUntil). */
export const NEW_OBEC_PAYMENT_DAYS = 30
export const WARN_DAYS_BEFORE = 7

const DAY_MS = 24 * 60 * 60 * 1000

const STAGE_DAYS: Record<Exclude<BillingStatus, 'active'>, number> = {
  suspended: SUSPENDED_GRACE_DAYS,
  read_only: READ_ONLY_DAYS,
  terminated: TERMINATED_DAYS,
}

export const billingStatusOf = (value: unknown): BillingStatus =>
  (BILLING_STATUSES as readonly unknown[]).includes(value) ? (value as BillingStatus) : 'active'

/** SMS and import are off — the obec is suspended or further along. */
export const servicesHeld = (status: unknown): boolean => billingStatusOf(status) !== 'active'

/** Nothing new written for the obec — read-only, or its contract ended. */
export const isReadOnly = (status: unknown): boolean => {
  const s = billingStatusOf(status)
  return s === 'read_only' || s === 'terminated'
}

/** When the obec moves on by itself: suspended → read-only → terminated → erased. Null when active
 * or the clock was never started (set before the field existed — the worker starts it). */
export function nextBillingStepAt(status: unknown, changedAt: string | null | undefined): Date | null {
  if (!changedAt) return null
  const s = billingStatusOf(status)
  const days = s === 'active' ? null : STAGE_DAYS[s]
  return days === null ? null : new Date(new Date(changedAt).getTime() + days * DAY_MS)
}

export const READ_ONLY_MESSAGE =
  'Obec má kvůli nezaplacené licenci přístup jen pro čtení — nic nového teď založit ani upravit nejde. Přihlášky na zveřejněné akce a jejich rušení fungují dál. Obnovu licence vyřídí provozovatel Lonvity.'

/**
 * Whether the platform has confirmed this obec's erasure for the terminated stage it is in now. The
 * confirmation IS the stage's start (`billingStatusChangedAt` as it was when the platform confirmed) —
 * so it holds only while that exact stage lasts: any later change of status, or of the clock, makes the
 * two differ and the obec unconfirmed again, with nothing having to clear it.
 */
export function erasureConfirmed(
  status: unknown,
  changedAt: string | null | undefined,
  confirmedStage: string | null | undefined,
): boolean {
  if (billingStatusOf(status) !== 'terminated' || !changedAt || !confirmedStage) return false
  return new Date(confirmedStage).getTime() === new Date(changedAt).getTime()
}

export const TERMINATED_MESSAGE =
  'Smlouva obce s Lonvitou skončila — nic nového teď založit ani upravit nejde. Stáhněte si všechna data obce v Nastavení; po uplynutí lhůty se údaje obce smažou. Přihlášky na zveřejněné akce a jejich rušení fungují dál.'

/** What a write refused for the obec says. */
export const writeRefusedMessage = (status: unknown): string =>
  billingStatusOf(status) === 'terminated' ? TERMINATED_MESSAGE : READ_ONLY_MESSAGE
