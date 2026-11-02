'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Plus,
  RefreshCw,
  ScrollText,
  Timer,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { RequireAuth, RequireRole } from '@/components/RequireAuth'
import { PageHeader } from '@/components/PageHeader'
import { Loading } from '@/components/Loading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton'
import { PayloadApiError } from '@/integrations/payload/client'
import {
  createLegalRequirement,
  deleteLegalRequirement,
  getStoredRetention,
  listLegalRequirements,
  markLegalRequirementReviewed,
  runComplianceCheck,
  saveRetention,
  updateLegalRequirement,
  type LegalRequirement,
  type LegalRequirementInput,
} from '@/integrations/payload/compliance-queries'
import { esbirkaPortalUrl, staleUrlOf } from '@/lib/compliance/esbirka'
import { RETENTION } from '@/lib/retention/policy'
import {
  EDITABLE_RETENTION,
  EDITABLE_RETENTION_KEYS,
  type EditableRetentionKey,
} from '@/lib/retention/settings'

const errorText = (error: unknown, fallback: string) =>
  error instanceof PayloadApiError && error.status < 500 ? error.message : fallback

const date = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' }) : '—'

const STATUS: Record<
  LegalRequirement['status'],
  { label: string; icon: LucideIcon; variant: 'outline' | 'secondary' | 'destructive' }
> = {
  ok: { label: 'V pořádku', icon: CheckCircle2, variant: 'outline' },
  review_needed: { label: 'Ke kontrole', icon: Clock, variant: 'secondary' },
  changed: { label: 'Změna předpisu', icon: AlertTriangle, variant: 'destructive' },
  gap: { label: 'Neplní se', icon: XCircle, variant: 'destructive' },
}

const KINDS: { value: LegalRequirement['kind']; label: string }[] = [
  { value: 'zakon', label: 'Zákon' },
  { value: 'vyhlaska', label: 'Vyhláška' },
  { value: 'eu', label: 'Nařízení EU' },
  { value: 'other', label: 'Jiné' },
]

const blank = (): LegalRequirementInput => ({
  code: '',
  title: '',
  kind: 'zakon',
  url: '',
  requirement: '',
  implementation: '',
  status: 'review_needed',
  reviewIntervalMonths: 12,
  esbirkaWatch: true,
  notes: '',
})

function RequirementForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: LegalRequirementInput
  onSave: (data: LegalRequirementInput) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set =
    <K extends keyof LegalRequirementInput>(key: K) =>
    (value: LegalRequirementInput[K]) =>
      setForm({ ...form, [key]: value })
  const watchable = staleUrlOf(form.code) !== null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.code.trim() || !form.title.trim()) {
      toast.error('Vyplňte označení a název předpisu.')
      return
    }
    setSaving(true)
    try {
      await onSave({ ...form, esbirkaWatch: watchable && Boolean(form.esbirkaWatch) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_9rem]">
        <div className="space-y-1">
          <Label htmlFor="lr-code">Označení</Label>
          <Input
            id="lr-code"
            value={form.code}
            onChange={(e) => set('code')(e.target.value)}
            placeholder="264/2025 Sb."
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lr-title">Název</Label>
          <Input id="lr-title" value={form.title} onChange={(e) => set('title')(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Druh</Label>
          <Select value={form.kind} onValueChange={(v) => set('kind')(v as LegalRequirement['kind'])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="lr-url">Odkaz (pokud není v e-Sbírce)</Label>
        <Input
          id="lr-url"
          value={form.url ?? ''}
          onChange={(e) => set('url')(e.target.value)}
          placeholder="https://eur-lex.europa.eu/…"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="lr-req">Co vyžaduje</Label>
        <Textarea
          id="lr-req"
          rows={3}
          value={form.requirement ?? ''}
          onChange={(e) => set('requirement')(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="lr-impl">Jak to Lonvita plní</Label>
        <Textarea
          id="lr-impl"
          rows={3}
          value={form.implementation ?? ''}
          onChange={(e) => set('implementation')(e.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3 items-end">
        <div className="space-y-1">
          <Label htmlFor="lr-interval">Kontrolovat každých (měsíců)</Label>
          <Input
            id="lr-interval"
            inputMode="numeric"
            value={String(form.reviewIntervalMonths ?? 12)}
            onChange={(e) => set('reviewIntervalMonths')(Math.max(1, Number(e.target.value) || 12))}
          />
        </div>
        <div className="space-y-1">
          <Label>Stav</Label>
          <Select value={form.status} onValueChange={(v) => set('status')(v as LegalRequirement['status'])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS) as LegalRequirement['status'][]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm pb-2">
          <Switch
            checked={watchable && Boolean(form.esbirkaWatch)}
            disabled={!watchable}
            onCheckedChange={set('esbirkaWatch')}
          />
          Hlídat v e-Sbírce
        </label>
      </div>
      {!watchable && form.code.trim() && (
        <p className="text-xs text-muted-foreground">
          V e-Sbírce jde hlídat jen předpis Sbírky zákonů ve tvaru „číslo/rok Sb.“ — tento kontrolujte ručně.
        </p>
      )}
      <div className="space-y-1">
        <Label htmlFor="lr-notes">Poznámky</Label>
        <Textarea id="lr-notes" rows={2} value={form.notes ?? ''} onChange={(e) => set('notes')(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          Uložit
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Zrušit
        </Button>
      </div>
    </form>
  )
}

function RequirementCard({ item, onChanged }: { item: LegalRequirement; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const status = STATUS[item.status]
  const esbirka = esbirkaPortalUrl(item.code)
  const link = esbirka ?? item.url ?? null

  const act = async (fn: () => Promise<void>, ok: string, fail: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      onChanged()
    } catch (error) {
      toast.error(errorText(error, fail))
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <Card>
        <CardContent className="p-4">
          <RequirementForm
            initial={{
              code: item.code,
              title: item.title,
              kind: item.kind,
              url: item.url ?? '',
              requirement: item.requirement ?? '',
              implementation: item.implementation ?? '',
              status: item.status,
              reviewIntervalMonths: item.reviewIntervalMonths ?? 12,
              esbirkaWatch: item.esbirkaWatch ?? false,
              notes: item.notes ?? '',
            }}
            onCancel={() => setEditing(false)}
            onSave={async (data) => {
              try {
                await updateLegalRequirement(item.id, data)
                toast.success('Předpis uložen.')
                setEditing(false)
                onChanged()
              } catch (error) {
                toast.error(errorText(error, 'Předpis se nepodařilo uložit.'))
              }
            }}
          />
        </CardContent>
      </Card>
    )
  }

  const reviewer =
    item.lastReviewedBy && typeof item.lastReviewedBy === 'object' ? ` (${item.lastReviewedBy.email})` : ''

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold">
              {item.code} <span className="font-normal text-muted-foreground">· {item.title}</span>
            </p>
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
              >
                {esbirka ? 'e-Sbírka' : 'Znění'} <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <Badge variant={status.variant} className="gap-1">
            <status.icon className="h-3 w-3" /> {status.label}
          </Badge>
        </div>

        {item.status === 'changed' && item.esbirkaChangeSummary && (
          <p className="text-sm rounded-md border border-destructive/40 bg-destructive/5 p-2">
            <strong>Zjištěno {date(item.esbirkaChangedAt)}:</strong> {item.esbirkaChangeSummary} Posuďte dopad
            (požadavky, lhůty uchování) a označte jako zkontrolováno.
          </p>
        )}
        {item.requirement && (
          <p className="text-sm whitespace-pre-line">
            <span className="text-muted-foreground">Vyžaduje: </span>
            {item.requirement}
          </p>
        )}
        {item.implementation && (
          <p className="text-sm whitespace-pre-line">
            <span className="text-muted-foreground">Plníme: </span>
            {item.implementation}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Naposledy zkontrolováno {date(item.lastReviewedAt)}
          {reviewer} · další kontrola {date(item.nextReviewAt)}
          {item.esbirkaWatch &&
            ` · e-Sbírka ${item.esbirkaCheckedAt ? `ověřena ${date(item.esbirkaCheckedAt)}` : 'zatím neověřena'}`}
        </p>
        {item.esbirkaError && <p className="text-xs text-destructive">e-Sbírka: {item.esbirkaError}</p>}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              act(() => markLegalRequirementReviewed(item.id), 'Označeno jako zkontrolované.', 'Nepodařilo se uložit.')
            }
          >
            <CheckCircle2 className="h-4 w-4" /> Zkontrolováno
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              act(
                () => markLegalRequirementReviewed(item.id, 'gap'),
                'Zapsáno, že se požadavek neplní.',
                'Nepodařilo se uložit.',
              )
            }
          >
            Zkontrolováno — neplní se
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Upravit
          </Button>
          <ConfirmDeleteButton
            title={`Odebrat ${item.code} z registru?`}
            description="Předpis přestane být hlídán. Do audit logu se zapíše, kdo ho odebral."
            errorMessage="Předpis se nepodařilo odebrat."
            onConfirm={async () => {
              await deleteLegalRequirement(item.id)
              onChanged()
            }}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function Register() {
  const [items, setItems] = useState<LegalRequirement[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [checking, setChecking] = useState(false)

  const load = useCallback(() => {
    listLegalRequirements()
      .then(setItems)
      .catch(() => toast.error('Registr se nepodařilo načíst.'))
  }, [])
  useEffect(load, [load])

  const check = async () => {
    setChecking(true)
    try {
      await runComplianceCheck()
      toast.success('Kontrola běží — výsledek se objeví do minuty (obnovte stránku).')
    } catch (error) {
      toast.error(errorText(error, 'Kontrolu se nepodařilo spustit.'))
    } finally {
      setChecking(false)
    }
  }

  if (!items) return <Loading />
  const waiting = items.filter((i) => i.status !== 'ok').length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-primary" />
          <p className="font-bold">Registr právních požadavků</p>
          {waiting > 0 && <Badge variant="destructive">{waiting} k řešení</Badge>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={check} disabled={checking}>
            <RefreshCw className="h-4 w-4" /> Zkontrolovat e-Sbírku teď
          </Button>
          <Button size="sm" onClick={() => setAdding(true)} disabled={adding}>
            <Plus className="h-4 w-4" /> Přidat předpis
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Každou noc se v e-Sbírce ověří, jestli u hlídaných předpisů nevyšlo nové znění nebo nebyla vyhlášena změna. Pak
        přijde upozornění a předpis se označí „Změna předpisu“. Co změna znamená pro Lonvitu, musí posoudit člověk.
      </p>
      {adding && (
        <Card>
          <CardContent className="p-4">
            <RequirementForm
              initial={blank()}
              onCancel={() => setAdding(false)}
              onSave={async (data) => {
                try {
                  await createLegalRequirement(data)
                  toast.success('Předpis přidán.')
                  setAdding(false)
                  load()
                } catch (error) {
                  toast.error(errorText(error, 'Předpis se nepodařilo přidat.'))
                }
              }}
            />
          </CardContent>
        </Card>
      )}
      {items.map((item) => (
        <RequirementCard key={item.id} item={item} onChanged={load} />
      ))}
    </div>
  )
}

function RetentionEditor() {
  const [values, setValues] = useState<Record<EditableRetentionKey, string> | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getStoredRetention()
      .then((stored) =>
        setValues(
          Object.fromEntries(
            EDITABLE_RETENTION_KEYS.map((k) => [k, typeof stored[k] === 'number' ? String(stored[k]) : '']),
          ) as Record<EditableRetentionKey, string>,
        ),
      )
      .catch(() => toast.error('Lhůty se nepodařilo načíst.'))
  }, [])

  if (!values) return <Loading />

  const save = async () => {
    const out: Record<string, number | null> = {}
    for (const key of EDITABLE_RETENTION_KEYS) {
      const text = values[key].trim()
      if (text === '') {
        out[key] = null
        continue
      }
      const n = Number(text)
      const rule = EDITABLE_RETENTION[key]
      if (!Number.isInteger(n) || n < rule.min) {
        toast.error(`${rule.label}: nejméně ${rule.min} ${rule.unit}.`)
        return
      }
      out[key] = n
    }
    setSaving(true)
    try {
      await saveRetention(out)
      toast.success('Lhůty uloženy — platí od příští noční úlohy.')
    } catch (error) {
      toast.error(errorText(error, 'Lhůty se nepodařilo uložit.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Timer className="h-5 w-5 text-primary" />
          <p className="font-bold">Lhůty uchování</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Jak dlouho se co uchovává. Když se změní zákon, upravíte číslo tady — bez programování. Pod zákonné minimum
          to nejde. Prázdné = výchozí hodnota. Každá změna se zapíše do audit logu.
        </p>
        {EDITABLE_RETENTION_KEYS.map((key) => {
          const rule = EDITABLE_RETENTION[key]
          return (
            <div key={key} className="grid gap-1 sm:grid-cols-[1fr_9rem] sm:items-center">
              <div>
                <Label htmlFor={`ret-${key}`}>{rule.label}</Label>
                <p className="text-xs text-muted-foreground">{rule.basis}</p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id={`ret-${key}`}
                  inputMode="numeric"
                  value={values[key]}
                  placeholder={String(RETENTION[key])}
                  onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                  className="h-9"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">{rule.unit}</span>
              </div>
            </div>
          )
        })}
        <Button onClick={save} disabled={saving} className="w-full">
          Uložit lhůty
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * Compliance for the platform's admins — the register of the law Lonvita keeps (watched in
 * e-Sbírka, reviewed on a schedule) and the retention periods, next to a link to the audit log.
 */
export default function CompliancePage() {
  return (
    <RequireAuth>
      <RequireRole role="superadmin">
        <Suspense fallback={<Loading />}>
          <div className="animate-fade-in">
            <PageHeader title="Compliance" back />
            <div className="px-4 py-5 space-y-6 max-w-5xl">
              <Link
                href="/superadmin/audit-log"
                className="flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
              >
                <FileText className="h-4 w-4" /> Audit log — kdo co kdy udělal, filtry, export CSV
              </Link>
              <Register />
              <RetentionEditor />
              <p className="text-xs text-muted-foreground">
                Registr je pomůcka k plnění povinností, ne právní posudek. Zda je Lonvita povinnou osobou podle zákona
                o kybernetické bezpečnosti (a v jakém režimu), má potvrdit právník.
              </p>
            </div>
          </div>
        </Suspense>
      </RequireRole>
    </RequireAuth>
  )
}
