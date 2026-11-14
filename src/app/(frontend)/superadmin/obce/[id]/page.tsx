'use client'

import { Suspense, use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bot, Camera, Globe, History, ListChecks, MessageSquare, ShieldCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { RequireAuth, RequireRole } from '@/components/RequireAuth'
import { PageHeader } from '@/components/PageHeader'
import { EventAreaCard } from '@/components/admin/EventAreaCard'
import { Loading } from '@/components/Loading'
import { ServicesCostCard, WEEKDAY_NAMES } from '@/components/admin/ServicesCostCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getBillingDetail,
  getStoredBillingCatalog,
  reviewImportRun,
  saveMunicipalityBilling,
  confirmObecErasure,
  withdrawObecErasure,
  takeActiveUserSnapshot,
  type BillingDetail,
  type BillingSettingsOfObec,
} from '@/integrations/payload/billing-queries'
import { PayloadApiError } from '@/integrations/payload/client'
import {
  catalogFrom,
  PACKAGE_KEYS,
  PACKAGE_LABELS,
  tierRangeLabel,
  type BillingCatalog,
  type PackageKey,
} from '@/lib/billing/catalog'
import { addDays, pragueToday, pragueWallTimeToIso } from '@/lib/import/time'
import {
  BILLING_STATUSES,
  BILLING_STATUS_LABELS,
  LICENCE_GRACE_DAYS,
  READ_ONLY_DAYS,
  SUSPENDED_GRACE_DAYS,
  TERMINATED_DAYS,
  WARN_DAYS_BEFORE,
} from '@/lib/billing/status'

type NumberKey =
  | 'licenceTier'
  | 'licenceCustomYearlyCzk'
  | 'implementationFeeCzk'
  | 'smsQuotaOverride'
  | 'scrapingMaxSourcesOverride'
  | 'scrapingMaxInputTokensOverride'

/** The inputs hold text — "" is "not set" (null). */
type Draft = Omit<
  BillingSettingsOfObec,
  'name' | NumberKey | 'licencePeriodStart' | 'licencePeriodEnd' | 'licencePaidUntil' | 'billingNote'
> &
  Record<NumberKey, string> & {
    licencePeriodStart: string
    licencePeriodEnd: string
    /** The last paid day (inclusive), as the date input holds it. */
    licencePaidUntil: string
    billingNote: string
  }

const toText = (value: number | null) => (value == null ? '' : String(value))
const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '')

const toDraft = ({ name: _name, ...s }: BillingSettingsOfObec): Draft => ({
  ...s,
  billingNote: s.billingNote ?? '',
  licencePeriodStart: dateInput(s.licencePeriodStart),
  licencePeriodEnd: dateInput(s.licencePeriodEnd),
  licencePaidUntil: lastPaidDay(s.licencePaidUntil),
  licenceTier: toText(s.licenceTier),
  licenceCustomYearlyCzk: toText(s.licenceCustomYearlyCzk),
  implementationFeeCzk: toText(s.implementationFeeCzk),
  smsQuotaOverride: toText(s.smsQuotaOverride),
  scrapingMaxSourcesOverride: toText(s.scrapingMaxSourcesOverride),
  scrapingMaxInputTokensOverride: toText(s.scrapingMaxInputTokensOverride),
})

/** null for an empty input, NaN for one that isn't a whole number ≥ 0. */
const toWhole = (text: string): number | null => {
  if (text.trim() === '') return null
  const value = Number(text.replace(/\s/g, ''))
  return Number.isInteger(value) && value >= 0 ? value : NaN
}

/** A date input's day as midnight UTC — the period's boundaries are whole days. */
/** Stored is the first unpaid moment (midnight in Prague after the last paid day); the input shows
 * the last paid day itself. */
const lastPaidDay = (iso: string | null) => (iso ? pragueToday(new Date(new Date(iso).getTime() - 1)) : '')
const paidUntilOf = (day: string): string | null => (day ? pragueWallTimeToIso(addDays(day, 1), null) : null)

const toDate = (text: string): string | null =>
  text ? new Date(`${text}T00:00:00.000Z`).toISOString() : null

const czk = (value: number) => `${value.toLocaleString('cs-CZ')} Kč`
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague',
    dateStyle: 'short',
    timeStyle: 'short',
  })

const FIELD_LABELS: Record<string, string> = {
  billingStatus: 'Stav',
  billingNote: 'Poznámka',
  licencePeriodStart: 'Začátek období',
  licencePeriodEnd: 'Konec období',
  licencePaidUntil: 'Zaplaceno do',
  licenceTier: 'Pásmo (ručně)',
  licenceCustomYearlyCzk: 'Individuální cena licence',
  implementationFeeCzk: 'Implementace',
  smsEnabled: 'SMS zapnuto',
  smsPackage: 'SMS balíček',
  smsQuotaOverride: 'SMS kvóta (ručně)',
  importAiEnabled: 'Scraping zapnut',
  scrapingPackage: 'Scraping balíček',
  scrapingMaxSourcesOverride: 'Max. zdrojů (ručně)',
  scrapingSlotDay: 'Den slotu',
  scrapingSlotHour: 'Hodina slotu',
  scrapingFrequency: 'Frekvence',
  scrapingMaxInputTokensOverride: 'Limit tokenů (ručně)',
}

const showValue = (value: unknown) =>
  value === null || value === undefined || value === ''
    ? '—'
    : value === true
      ? 'ano'
      : value === false
        ? 'ne'
        : String(value)

const RUN_STATUS: Record<string, string> = {
  running: 'Běží',
  success: 'Hotovo',
  unchanged: 'Beze změny',
  failed: 'Chyba',
  skipped: 'Přeskočeno',
}

function Section({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: LucideIcon
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            <p className="font-bold">{title}</p>
          </div>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id?: string
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function NumberInput({
  id,
  value,
  placeholder,
  onChange,
}: {
  id: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="h-11"
    />
  )
}

function PackageSelect({
  value,
  onChange,
  describe,
}: {
  value: string
  onChange: (v: PackageKey) => void
  describe: (k: PackageKey) => string
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as PackageKey)}>
      <SelectTrigger className="h-11">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PACKAGE_KEYS.map((k) => (
          <SelectItem key={k} value={k}>
            {PACKAGE_LABELS[k]} — {describe(k)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RunReview({ run, onSaved }: { run: BillingDetail['runs'][number]; onSaved: () => void }) {
  const [note, setNote] = useState(run.reviewNote ?? '')
  const [saving, setSaving] = useState(false)
  const save = async (status: 'ok' | 'problem' | null) => {
    setSaving(true)
    try {
      await reviewImportRun(run.id, status, note)
      onSaved()
    } catch {
      toast.error('Kontrolu se nepodařilo uložit.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Poznámka"
        className="h-8 w-40 text-xs"
      />
      <Button
        size="sm"
        variant={run.reviewStatus === 'ok' ? 'default' : 'outline'}
        disabled={saving}
        onClick={() => save('ok')}
        className="h-8"
      >
        OK
      </Button>
      <Button
        size="sm"
        variant={run.reviewStatus === 'problem' ? 'destructive' : 'outline'}
        disabled={saving}
        onClick={() => save('problem')}
        className="h-8"
      >
        Problém
      </Button>
      {run.reviewStatus && (
        <Button
          size="sm"
          variant="ghost"
          disabled={saving}
          onClick={() => save(null)}
          className="h-8"
        >
          Zrušit
        </Button>
      )}
    </div>
  )
}

/**
 * One obec's packages for the platform (Balíčky služeb: "Co má umět superadmin") — its status
 * (suspend an obec that doesn't pay: SMS and scraping stop), the licence band and period, the SMS and
 * scraping packages with every limit settable for it alone, its user snapshots, sources, the scraping
 * run log with the platform's check of each run, and who changed what.
 */
function MunicipalityBillingContent({ municipalityId }: { municipalityId: string }) {
  const [detail, setDetail] = useState<BillingDetail | null>(null)
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [snapshotting, setSnapshotting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [erasureName, setErasureName] = useState('')
  const [erasureBusy, setErasureBusy] = useState(false)

  const load = useCallback(
    (resetDraft: boolean) =>
      getBillingDetail(municipalityId)
        .then((d) => {
          setDetail(d)
          if (resetDraft) setDraft(toDraft(d.settings))
        })
        .catch(() => toast.error('Obec se nepodařilo načíst.')),
    [municipalityId],
  )

  useEffect(() => {
    load(true)
    getStoredBillingCatalog()
      .then((c) => setCatalog(catalogFrom(c)))
      .catch(() => setCatalog(catalogFrom(null)))
  }, [load])

  if (!detail || !draft || !catalog)
    return (
      <>
        <PageHeader title="Balíček obce" back />
        <Loading />
      </>
    )

  const set =
    <K extends keyof Draft>(key: K) =>
    (value: Draft[K]) =>
      setDraft({ ...draft, [key]: value })

  const services = detail.services
  const tiers = catalog.licenceTiers

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const numbers = {
      licenceTier: toWhole(draft.licenceTier),
      licenceCustomYearlyCzk: toWhole(draft.licenceCustomYearlyCzk),
      implementationFeeCzk: toWhole(draft.implementationFeeCzk),
      smsQuotaOverride: toWhole(draft.smsQuotaOverride),
      scrapingMaxSourcesOverride: toWhole(draft.scrapingMaxSourcesOverride),
      scrapingMaxInputTokensOverride: toWhole(draft.scrapingMaxInputTokensOverride),
    }
    if (Object.values(numbers).some((v) => Number.isNaN(v))) {
      toast.error('Čísla musí být celá, od nuly výš, nebo prázdná.')
      return
    }
    if (numbers.licenceTier != null && numbers.licenceTier >= tiers.length) {
      toast.error(`Pásmo může být 0 až ${tiers.length - 1}.`)
      return
    }
    if (
      draft.licencePeriodStart &&
      draft.licencePeriodEnd &&
      draft.licencePeriodEnd <= draft.licencePeriodStart
    ) {
      toast.error('Konec období musí být po jeho začátku.')
      return
    }
    setSaving(true)
    try {
      await saveMunicipalityBilling(municipalityId, {
        ...draft,
        ...numbers,
        billingNote: draft.billingNote.trim() || null,
        licencePeriodStart: toDate(draft.licencePeriodStart),
        licencePeriodEnd: toDate(draft.licencePeriodEnd),
        licencePaidUntil: paidUntilOf(draft.licencePaidUntil),
      })
      await load(true)
      setRefreshKey((k) => k + 1)
      toast.success('Balíček obce uložen.')
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status < 500
          ? error.message
          : 'Balíček se nepodařilo uložit.',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleSnapshot = async () => {
    setSnapshotting(true)
    try {
      const s = await takeActiveUserSnapshot(municipalityId)
      toast.success(`Snímek ${s.month}: ${s.activeUsers} uživatelů.`)
      await load(false)
      setRefreshKey((k) => k + 1)
    } catch {
      toast.error('Snímek se nepodařilo uložit.')
    } finally {
      setSnapshotting(false)
    }
  }

  const handleErasure = async (confirm: boolean) => {
    setErasureBusy(true)
    try {
      if (confirm) await confirmObecErasure(municipalityId, erasureName)
      else await withdrawObecErasure(municipalityId)
      setErasureName('')
      toast.success(confirm ? 'Smazání potvrzeno.' : 'Potvrzení smazání zrušeno.')
      await load(false)
    } catch (error) {
      toast.error(error instanceof PayloadApiError ? error.message : 'Potvrzení se nepodařilo uložit.')
    } finally {
      setErasureBusy(false)
    }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Balíček obce" subtitle={detail.settings.name} back />
      <div className="px-4 py-5 space-y-4 max-w-2xl md:grid md:grid-cols-2 md:max-w-6xl md:gap-4 md:space-y-0 md:items-start">
        <form onSubmit={handleSave} className="space-y-4">
          <Section
            icon={ShieldCheck}
            title="Stav a licence"
            action={
              <Badge variant={draft.billingStatus === 'active' ? 'outline' : 'destructive'}>
                {BILLING_STATUS_LABELS[draft.billingStatus]}
              </Badge>
            }
          >
            <Field
              label="Stav obce"
              hint={`Pozastaveno (nezaplatila): SMS i scraping se zastaví, akce běží dál. Po ${SUSPENDED_GRACE_DAYS} dnech přejde obec sama do režimu jen pro čtení: nic nového nezaloží ani neupraví, přihlášky a rušení akcí fungují. Po dalších ${READ_ONLY_DAYS} dnech smlouva skončí (Ukončeno): obec si stáhne data a po ${TERMINATED_DAYS} dnech se všechny údaje obce nevratně smažou, akce po tomto datu se týden předem zruší. Ukončeno lze nastavit i ručně při konci smlouvy. Adminy před každým krokem upozorníme ${WARN_DAYS_BEFORE} dní předem; obyvatele při ukončení.`}
            >
              <Select
                value={draft.billingStatus}
                onValueChange={(v) => set('billingStatus')(v as Draft['billingStatus'])}
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {BILLING_STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {detail.services.billingStatusChangedAt && detail.settings.billingStatus !== 'active' && (
                <p className="text-xs text-muted-foreground">
                  {BILLING_STATUS_LABELS[detail.settings.billingStatus]} od{' '}
                  {dateTime(detail.services.billingStatusChangedAt)}
                  {detail.services.billingNextStepAt &&
                    (detail.settings.billingStatus === 'suspended'
                      ? ` · jen pro čtení od ${dateTime(detail.services.billingNextStepAt)}`
                      : detail.settings.billingStatus === 'read_only'
                        ? ` · smlouva skončí ${dateTime(detail.services.billingNextStepAt)}`
                        : ` · údaje obce se nevratně smažou ${dateTime(detail.services.billingNextStepAt)}`)}
                </p>
              )}
            </Field>
            <Field
              id="billing-note"
              label="Interní poznámka"
              hint="Jen pro provozovatele — např. stav plateb, dohoda s obcí."
            >
              <Textarea
                id="billing-note"
                value={draft.billingNote}
                onChange={(e) => set('billingNote')(e.target.value)}
                rows={2}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="period-start" label="Začátek období">
                <Input
                  id="period-start"
                  type="date"
                  value={draft.licencePeriodStart}
                  onChange={(e) => set('licencePeriodStart')(e.target.value)}
                  className="h-11"
                />
              </Field>
              <Field id="period-end" label="Konec období">
                <Input
                  id="period-end"
                  type="date"
                  value={draft.licencePeriodEnd}
                  onChange={(e) => set('licencePeriodEnd')(e.target.value)}
                  className="h-11"
                />
              </Field>
            </div>
            <Field
              id="paid-until"
              label="Licence zaplacena do (včetně)"
              hint={`Při platbě nebo prodloužení posuňte. Po tomto dni se roční kvóta SMS neobnoví, admini obce dostanou upozornění (i ${WARN_DAYS_BEFORE} dní předem) a po ${LICENCE_GRACE_DAYS} dnech se obec sama pozastaví. Po prodloužení vraťte obec do stavu Aktivní.`}
            >
              <Input
                id="paid-until"
                type="date"
                required
                value={draft.licencePaidUntil}
                onChange={(e) => set('licencePaidUntil')(e.target.value)}
                className="h-11"
              />
              {detail.services.licence.lapsed && (
                <p className="text-xs text-destructive">Licence vypršela — nová kvóta SMS se nenačetla.</p>
              )}
            </Field>
            <p className="text-xs text-muted-foreground -mt-2">
              Prázdné: kalendářní rok. Konec prázdný: rok od začátku. V období se počítá kvóta SMS.
            </p>
            <Field
              label="Pásmo licence"
              hint={`Vypočteno: pásmo ${services.licence.computedTier} z průměru ${services.licence.averageUsers} uživatelů (${
                services.licence.snapshotsUsed
                  ? `posledních ${services.licence.snapshotsUsed} snímků`
                  : 'zatím bez snímku, počet teď'
              }). ${
                services.licence.tierManual
                  ? 'Pásmo je nastavené ručně — automatika ho nemění.'
                  : services.licence.tierFixedForYear
                    ? `Účtuje se pásmo ${services.licence.tier}, fixované na licenční rok: při růstu se od dalšího měsíce zvýší s poměrným doplatkem (nikdy zpětně), snížení až při obnově licence.`
                    : 'Pásmo se na licenční rok zafixuje při nejbližším nočním běhu.'
              }`}
            >
              <Select
                value={draft.licenceTier === '' ? 'auto' : draft.licenceTier}
                onValueChange={(v) => set('licenceTier')(v === 'auto' ? '' : v)}
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    Automaticky (pásmo {services.licence.computedTier})
                  </SelectItem>
                  {tiers.map((t, i) => (
                    <SelectItem key={i} value={String(i)}>
                      Pásmo {i} — {tierRangeLabel(tiers, i)} uživatelů · {czk(t.yearlyPriceCzk)}/rok
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {detail.licenceUpgrades.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-semibold">Přechody do vyššího pásma (k vyfakturování)</p>
                {detail.licenceUpgrades.map((u) => (
                  <p key={u.createdAt} className="text-xs text-muted-foreground tabular-nums">
                    {dateTime(u.createdAt)}: pásmo {u.fromTier} → {u.toTier} (průměr {u.averageUsers} uživatelů), od{' '}
                    {dateTime(u.effectiveFrom)}, {u.monthsCharged}/{u.periodMonths} měsíců → doplatek {czk(u.surchargeCzk)}
                  </p>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field
                id="custom-price"
                label="Individuální cena (Kč/rok)"
                hint="Např. Žďár — místo ceny pásma."
              >
                <NumberInput
                  id="custom-price"
                  value={draft.licenceCustomYearlyCzk}
                  placeholder="podle pásma"
                  onChange={set('licenceCustomYearlyCzk')}
                />
              </Field>
              <Field
                id="impl-fee"
                label="Implementace (Kč)"
                hint={`Ceník: ${czk(catalog.implementationFeeCzk)}`}
              >
                <NumberInput
                  id="impl-fee"
                  value={draft.implementationFeeCzk}
                  placeholder="podle ceníku"
                  onChange={set('implementationFeeCzk')}
                />
              </Field>
            </div>
          </Section>

          {detail.settings.billingStatus === 'terminated' && (

            <Section icon={ShieldCheck} title="Smazání dat obce">

              <p className="text-sm text-muted-foreground">

                Smlouva skončila. Údaje obce se smažou nevratně nejdříve{' '}

                {detail.services.billingNextStepAt ? dateTime(detail.services.billingNextStepAt) : '—'}, a to jen když to

                tady sami potvrdíte. Bez potvrzení se nic nesmaže, obec jen zůstane ve stavu Ukončeno. Potvrzení platí jen pro

                tento stav — vrátíte-li obec do Aktivní nebo ji znovu ukončíte, je potřeba potvrdit znovu.

              </p>

              {detail.erasureConfirmed ? (

                <>

                  <p className="text-sm text-destructive">

                    Smazání je potvrzeno. Po uplynutí lhůty se obec smaže při nejbližším nočním běhu.

                  </p>

                  <Button type="button" variant="outline" className="h-11" disabled={erasureBusy} onClick={() => handleErasure(false)}>

                    Zrušit potvrzení

                  </Button>

                </>

              ) : (

                <>

                  <Field label="Pro potvrzení opište název obce" hint={detail.settings.name}>

                    <Input value={erasureName} onChange={(e) => setErasureName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} className="h-11" autoComplete="off" />

                  </Field>

                  <Button

                    type="button"

                    variant="destructive"

                    className="h-11"

                    disabled={erasureBusy || erasureName.trim() !== detail.settings.name.trim()}

                    onClick={() => handleErasure(true)}

                  >

                    Potvrdit nevratné smazání dat obce

                  </Button>

                </>

              )}

            </Section>

          )}


          <Section
            icon={MessageSquare}
            title="SMS"
            action={
              <Switch
                checked={draft.smsEnabled}
                onCheckedChange={set('smsEnabled')}
                aria-label="SMS zapnuto"
              />
            }
          >
            {draft.smsEnabled ? (
              <>
                <Field label="Balíček">
                  <PackageSelect
                    value={draft.smsPackage}
                    onChange={set('smsPackage')}
                    describe={(k) =>
                      `${catalog.smsPackages[k].quota.toLocaleString('cs-CZ')} SMS/rok · ${czk(catalog.smsPackages[k].yearlyPriceCzk)}`
                    }
                  />
                </Field>
                <Field
                  id="sms-quota"
                  label="Vlastní roční kvóta (SMS části)"
                  hint="Prázdné: podle balíčku."
                >
                  <NumberInput
                    id="sms-quota"
                    value={draft.smsQuotaOverride}
                    placeholder="podle balíčku"
                    onChange={set('smsQuotaOverride')}
                  />
                </Field>
                <p className="text-xs text-muted-foreground">
                  Zrušení akce, které začne, dokud obci zbývá aspoň 1 SMS, se rozešle všem; SMS nad
                  kvótu se vyúčtují jako přečerpání ({czk(catalog.smsOveragePriceCzk)}/ks, podle
                  smluvních podmínek). Potom už jen e-mail a aplikace.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Obec SMS nemá — všechna upozornění jdou e-mailem a do aplikace.
              </p>
            )}
          </Section>

          <Section
            icon={Bot}
            title="Scraping (import akcí z webu)"
            action={
              <Switch
                checked={draft.importAiEnabled}
                onCheckedChange={set('importAiEnabled')}
                aria-label="Scraping zapnut"
              />
            }
          >
            {draft.importAiEnabled ? (
              <>
                <Field label="Balíček">
                  <PackageSelect
                    value={draft.scrapingPackage}
                    onChange={set('scrapingPackage')}
                    describe={(k) =>
                      `do ${catalog.scrapingPackages[k].maxSources} zdrojů · ${czk(catalog.scrapingPackages[k].yearlyPriceCzk)}`
                    }
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    id="max-sources"
                    label="Vlastní max. zdrojů"
                    hint={`Nad balíček se účtuje ${czk(catalog.scrapingExtraSourcePriceCzk)}/rok za zdroj.`}
                  >
                    <NumberInput
                      id="max-sources"
                      value={draft.scrapingMaxSourcesOverride}
                      placeholder="podle balíčku"
                      onChange={set('scrapingMaxSourcesOverride')}
                    />
                  </Field>
                  <Field
                    id="max-tokens"
                    label="Limit tokenů na běh"
                    hint={`Ceník: ${catalog.maxInputTokensPerRun.toLocaleString('cs-CZ')}`}
                  >
                    <NumberInput
                      id="max-tokens"
                      value={draft.scrapingMaxInputTokensOverride}
                      placeholder="podle ceníku"
                      onChange={set('scrapingMaxInputTokensOverride')}
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Den">
                    <Select
                      value={String(draft.scrapingSlotDay)}
                      onValueChange={(v) => set('scrapingSlotDay')(Number(v))}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEEKDAY_NAMES.map((name, i) => (
                          <SelectItem key={name} value={String(i + 1)}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Hodina">
                    <Select
                      value={String(draft.scrapingSlotHour)}
                      onValueChange={(v) => set('scrapingSlotHour')(Number(v))}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 24 }, (_, h) => (
                          <SelectItem key={h} value={String(h)}>
                            {h}:00
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Frekvence">
                    <Select
                      value={draft.scrapingFrequency}
                      onValueChange={(v) =>
                        set('scrapingFrequency')(v as Draft['scrapingFrequency'])
                      }
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">1× týdně</SelectItem>
                        <SelectItem value="twice_weekly">
                          2× týdně (+{czk(catalog.scrapingTwiceWeeklyPriceCzk)}/rok)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Obec scraping nemá — zdroje akcí přidávat nemůže a nic se nestahuje.
              </p>
            )}
          </Section>

          <Button type="submit" disabled={saving} className="w-full h-11">
            Uložit balíček obce
          </Button>
        </form>

        <div className="space-y-4">
          <ServicesCostCard municipalityId={municipalityId} refreshKey={refreshKey} />

          <Section
            icon={Camera}
            title="Uživatelé obce — měsíční snímky"
            action={
              <Button size="sm" variant="outline" onClick={handleSnapshot} disabled={snapshotting}>
                Uložit snímek teď
              </Button>
            }
          >
            <p className="text-xs text-muted-foreground">
              Uživatel = registrovaný účet s domovskou obcí nebo s rolí v obci, každý jednou. Snímek
              se ukládá sám 1. den v měsíci.
            </p>
            {detail.snapshots.length === 0 ? (
              <p className="text-sm text-muted-foreground">Zatím žádný snímek.</p>
            ) : (
              <div className="divide-y divide-border text-sm">
                {detail.snapshots.map((s) => (
                  <div key={s.month} className="flex justify-between py-1.5">
                    <span>
                      {s.month}
                      {s.byHand && <span className="text-muted-foreground"> · ručně</span>}
                    </span>
                    <span className="font-semibold tabular-nums">
                      {s.activeUsers.toLocaleString('cs-CZ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section icon={Globe} title={`Zdroje akcí (${detail.sources.length})`}>
            {detail.sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">Obec nemá žádný zdroj.</p>
            ) : (
              <div className="divide-y divide-border">
                {detail.sources.map((s) => (
                  <div key={s.id} className="py-2 text-sm space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold truncate hover:underline"
                      >
                        {s.label}
                      </a>
                      <Badge variant={s.enabled ? 'outline' : 'secondary'}>
                        {s.enabled ? 'Zapnutý' : 'Vypnutý'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{s.url}</p>
                    <p className="text-xs text-muted-foreground">
                      Zadal/a {s.createdBy ?? '—'} · {dateTime(s.createdAt)}
                      {s.lastRunAt && ` · naposledy ${dateTime(s.lastRunAt)}`}
                    </p>
                    {s.lastError && <p className="text-xs text-destructive">{s.lastError}</p>}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        <div className="md:col-span-2">
          <Section icon={ListChecks} title="Log běhů scrapingu (posledních 100)">
            {detail.runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Zatím žádný běh.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Kdy</th>
                      <th className="py-1.5 pr-3 font-medium">Zdroj</th>
                      <th className="py-1.5 pr-3 font-medium">Stav</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Nalezeno / nových</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Tokeny in / out</th>
                      <th className="py-1.5 font-medium">Kontrola</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detail.runs.map((r) => (
                      <tr key={r.id} className="align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">{dateTime(r.startedAt)}</td>
                        <td className="py-2 pr-3 max-w-[14rem] truncate">
                          {r.source ??
                            (r.trigger === 'text'
                              ? 'Vložený text'
                              : r.trigger === 'file'
                                ? 'Soubor'
                                : '—')}
                        </td>
                        <td className="py-2 pr-3">
                          <span className={r.status === 'failed' ? 'text-destructive' : undefined}>
                            {RUN_STATUS[r.status] ?? r.status}
                          </span>
                          {r.error && (
                            <p className="text-xs text-muted-foreground max-w-[16rem]">{r.error}</p>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {r.found} / {r.created}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                          {r.inputTokens.toLocaleString('cs-CZ')} /{' '}
                          {r.outputTokens.toLocaleString('cs-CZ')}
                        </td>
                        <td className="py-2">
                          <RunReview run={r} onSaved={() => load(false)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>

        <div className="md:col-span-2">
          <EventAreaCard municipalityId={municipalityId} />
        </div>

        <div className="md:col-span-2">
          <Section icon={History} title="Historie změn balíčku">
            {detail.audit.length === 0 ? (
              <p className="text-sm text-muted-foreground">Zatím beze změn.</p>
            ) : (
              <div className="divide-y divide-border">
                {detail.audit.map((a) => (
                  <div key={a.id} className="py-2 text-sm">
                    <p className="font-semibold">
                      {dateTime(a.at)} · {a.actor ?? 'systém'}
                    </p>
                    <ul className="text-muted-foreground">
                      {Object.entries(a.changes).map(([field, c]) => (
                        <li key={field}>
                          {FIELD_LABELS[field] ?? field}: {showValue(c.from)} → {showValue(c.to)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Section>
          <p className="text-xs text-muted-foreground mt-3">
            Ceník balíčků a měsíční přehled všech obcí:{' '}
            <Link href="/superadmin/fakturace" className="underline">
              Balíčky a fakturace
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}

export default function MunicipalityBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <RequireAuth>
      <RequireRole role="superadmin">
        <Suspense fallback={<Loading />}>
          <MunicipalityBillingContent municipalityId={id} />
        </Suspense>
      </RequireRole>
    </RequireAuth>
  )
}
