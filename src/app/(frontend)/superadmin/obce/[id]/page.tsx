'use client'

import { Suspense, use, useEffect, useState } from 'react'
import { Bot, Mail, MessageSquare } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { RequireAuth, RequireRole } from '@/components/RequireAuth'
import { PageHeader } from '@/components/PageHeader'
import { Loading } from '@/components/Loading'
import { ServicesCostCard } from '@/components/admin/ServicesCostCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  getMunicipalityServicesSettings,
  setMunicipalityServices,
  type MunicipalityServicesSettings,
} from '@/integrations/payload/queries'

/** The inputs hold text — "" is "not set" (null), a decimal comma is fine. */
type Draft = Record<
  'emailPriceCzk' | 'smsPriceCzk' | 'smsMonthlyLimit' | 'importAiPriceCzk' | 'importAiBudgetUsd',
  string
> & {
  smsEnabled: boolean
  importAiEnabled: boolean
}

const toText = (value: number | null) => (value == null ? '' : String(value))

const toDraft = (s: MunicipalityServicesSettings): Draft => ({
  emailPriceCzk: toText(s.emailPriceCzk),
  smsEnabled: s.smsEnabled,
  smsPriceCzk: toText(s.smsPriceCzk),
  smsMonthlyLimit: toText(s.smsMonthlyLimit),
  importAiEnabled: s.importAiEnabled,
  importAiPriceCzk: toText(s.importAiPriceCzk),
  importAiBudgetUsd: toText(s.importAiBudgetUsd),
})

/** null for an empty input, NaN for one that isn't a number ≥ 0. */
const toNumber = (text: string): number | null => {
  if (text.trim() === '') return null
  const value = Number(text.replace(',', '.').replace(/\s/g, ''))
  return Number.isFinite(value) && value >= 0 ? value : NaN
}

function NumberField({
  id,
  label,
  suffix,
  value,
  placeholder,
  onChange,
}: {
  id: string
  label: string
  suffix: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2 mt-1.5">
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="h-11"
        />
        <span className="text-sm text-muted-foreground whitespace-nowrap">{suffix}</span>
      </div>
    </div>
  )
}

function ServiceSection({
  icon: Icon,
  title,
  description,
  toggle,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  toggle?: { id: string; checked: boolean; onChange: (checked: boolean) => void }
  children: React.ReactNode
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Icon className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            {toggle ? (
              <Label htmlFor={toggle.id} className="text-base font-semibold">
                {title}
              </Label>
            ) : (
              <p className="text-base font-semibold">{title}</p>
            )}
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
        {toggle && (
          <Switch id={toggle.id} checked={toggle.checked} onCheckedChange={toggle.onChange} />
        )}
      </div>
      {children}
    </div>
  )
}

/**
 * One obec's services, for the platform's admins: what it has switched on, what each costs it a
 * month and the limits that price covers — next to what it has used this month (ServicesCostCard,
 * the same card its admins see in Nastavení, with the AI's USD on top here).
 */
function MunicipalityServicesContent({ municipalityId }: { municipalityId: string }) {
  const [name, setName] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    getMunicipalityServicesSettings(municipalityId)
      .then(({ name, ...settings }) => {
        setName(name)
        setDraft(toDraft(settings))
      })
      .catch(() => toast.error('Obec se nepodařilo načíst.'))
  }, [municipalityId])

  if (!draft)
    return (
      <>
        <PageHeader title="Služby obce" back />
        <Loading />
      </>
    )

  const set =
    <K extends keyof Draft>(key: K) =>
    (value: Draft[K]) =>
      setDraft({ ...draft, [key]: value })

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const settings: MunicipalityServicesSettings = {
      emailPriceCzk: toNumber(draft.emailPriceCzk),
      smsEnabled: draft.smsEnabled,
      smsPriceCzk: toNumber(draft.smsPriceCzk),
      smsMonthlyLimit: toNumber(draft.smsMonthlyLimit),
      importAiEnabled: draft.importAiEnabled,
      importAiPriceCzk: toNumber(draft.importAiPriceCzk),
      importAiBudgetUsd: toNumber(draft.importAiBudgetUsd),
    }
    if (Object.values(settings).some((v) => typeof v === 'number' && Number.isNaN(v))) {
      toast.error('Ceny a limity musí být čísla od nuly výš, nebo prázdné.')
      return
    }
    if (settings.smsMonthlyLimit != null && !Number.isInteger(settings.smsMonthlyLimit)) {
      toast.error('Limit SMS musí být celé číslo.')
      return
    }
    setSaving(true)
    try {
      await setMunicipalityServices(municipalityId, settings)
      setRefreshKey((k) => k + 1)
      toast.success('Služby obce uloženy.')
    } catch {
      toast.error('Služby se nepodařilo uložit.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Služby obce" subtitle={name} back />
      <div className="px-4 py-5 space-y-4 max-w-2xl md:grid md:grid-cols-2 md:max-w-5xl md:gap-4 md:space-y-0 md:items-start">
        <Card>
          <CardContent className="p-4">
            <form onSubmit={handleSave} className="space-y-6">
              <ServiceSection
                icon={Mail}
                title="E-maily"
                description="Má každá obec — nastavuje se jen cena."
              >
                <NumberField
                  id="email-price"
                  label="Cena"
                  suffix="Kč / měs."
                  value={draft.emailPriceCzk}
                  placeholder="v ceně"
                  onChange={set('emailPriceCzk')}
                />
              </ServiceSection>

              <ServiceSection
                icon={MessageSquare}
                title="SMS"
                description="Při zrušení akce dostanou přihlášení i SMS."
                toggle={{
                  id: 'sms-enabled',
                  checked: draft.smsEnabled,
                  onChange: set('smsEnabled'),
                }}
              >
                {draft.smsEnabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField
                      id="sms-price"
                      label="Cena"
                      suffix="Kč / měs."
                      value={draft.smsPriceCzk}
                      onChange={set('smsPriceCzk')}
                    />
                    <NumberField
                      id="sms-limit"
                      label="Limit"
                      suffix="SMS / měs."
                      value={draft.smsMonthlyLimit}
                      placeholder="bez limitu"
                      onChange={set('smsMonthlyLimit')}
                    />
                  </div>
                )}
              </ServiceSection>

              <ServiceSection
                icon={Bot}
                title="Import akcí pomocí AI"
                description="Bez něj se zdroje čtou jen z iCal a strukturovaných dat."
                toggle={{
                  id: 'ai-enabled',
                  checked: draft.importAiEnabled,
                  onChange: set('importAiEnabled'),
                }}
              >
                {draft.importAiEnabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField
                      id="ai-price"
                      label="Cena"
                      suffix="Kč / měs."
                      value={draft.importAiPriceCzk}
                      onChange={set('importAiPriceCzk')}
                    />
                    <NumberField
                      id="ai-budget"
                      label="Limit AI"
                      suffix="$ / měs."
                      value={draft.importAiBudgetUsd}
                      placeholder="výchozí"
                      onChange={set('importAiBudgetUsd')}
                    />
                  </div>
                )}
              </ServiceSection>

              <Button type="submit" disabled={saving} className="w-full h-11">
                Uložit
              </Button>
            </form>
          </CardContent>
        </Card>

        <ServicesCostCard municipalityId={municipalityId} refreshKey={refreshKey} />
      </div>
    </div>
  )
}

export default function MunicipalityServicesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <RequireAuth>
      <RequireRole role="superadmin">
        <Suspense fallback={<Loading />}>
          <MunicipalityServicesContent municipalityId={id} />
        </Suspense>
      </RequireRole>
    </RequireAuth>
  )
}
