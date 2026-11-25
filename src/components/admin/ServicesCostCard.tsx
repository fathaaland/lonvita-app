'use client'

import { useEffect, useState } from 'react'
import { Bot, Mail, MessageSquare, ShieldCheck, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { getMunicipalityServices } from '@/integrations/payload/queries'
import { PACKAGE_LABELS } from '@/lib/billing/catalog'
import { BILLING_STATUS_LABELS, READ_ONLY_MESSAGE, TERMINATED_MESSAGE } from '@/lib/billing/status'
import type { MunicipalityServices } from '@/lib/services/municipality-services'

const czk = (value: number) => `${value.toLocaleString('cs-CZ')} Kč`
const num = (value: number) => value.toLocaleString('cs-CZ')
const date = (iso: string) =>
  new Date(iso).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' })
/** The period's last day — `periodEnd` is the first moment after it. */
const lastDay = (iso: string) => date(new Date(new Date(iso).getTime() - 1).toISOString())

export const WEEKDAY_NAMES = ['pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota', 'neděle']

function Meter({ used, limit }: { used: number; limit: number }) {
  const share = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100
  return (
    <Progress
      value={share}
      indicatorClassName={share >= 100 ? 'bg-destructive' : share >= 80 ? 'bg-warning' : 'bg-primary'}
    />
  )
}

function Row({
  icon: Icon,
  title,
  badge,
  price,
  children,
}: {
  icon: LucideIcon
  title: string
  badge?: React.ReactNode
  price?: string | null
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">{title}</p>
          {badge}
        </div>
        {children}
        {price && <p className="text-sm font-semibold tabular-nums">{price}</p>}
      </div>
    </div>
  )
}

/**
 * The obec's packages and how much of them it used (Balíčky služeb) — the licence band, SMS and
 * scraping. Its admins see this in Nastavení, without prices (they can't change anything here); a
 * platform admin sees the prices too. `refreshKey` loads it again after the packages changed.
 */
export function ServicesCostCard({
  municipalityId,
  refreshKey,
}: {
  municipalityId: string
  refreshKey?: number
}) {
  const [services, setServices] = useState<MunicipalityServices | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let current = true
    getMunicipalityServices(municipalityId)
      .then((s) => {
        if (!current) return
        setServices(s)
        setFailed(false)
      })
      .catch(() => current && setFailed(true))
    return () => {
      current = false
    }
  }, [municipalityId, refreshKey])

  const s = services
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            <p className="font-bold">Balíček služeb</p>
          </div>
          {s && s.billingStatus !== 'active' && (
            <Badge variant="destructive">{BILLING_STATUS_LABELS[s.billingStatus]}</Badge>
          )}
        </div>

        {failed ? (
          <p className="text-sm text-muted-foreground">Služby se nepodařilo načíst.</p>
        ) : !s ? (
          <p className="text-sm text-muted-foreground">Načítám…</p>
        ) : (
          <>
            {s.billingStatus === 'suspended' && (
              <p className="text-sm text-destructive">
                SMS a import akcí z webu jsou pozastavené. Akce, přihlášky a e-maily fungují dál.
                {s.billingNextStepAt &&
                  ` Pokud licenci neobnovíte do ${date(s.billingNextStepAt)}, obec přejde do režimu jen pro čtení.`}
              </p>
            )}
            {s.billingStatus === 'read_only' && <p className="text-sm text-destructive">{READ_ONLY_MESSAGE}</p>}
            {s.billingStatus === 'terminated' && (
              <p className="text-sm text-destructive">
                {TERMINATED_MESSAGE}
                {s.billingNextStepAt && ` Údaje se smažou ${date(s.billingNextStepAt)}.`}
              </p>
            )}
            <Row
              icon={ShieldCheck}
              title="Licence"
              badge={
                <Badge variant="outline">
                  {s.licence.tier != null ? `Pásmo ${s.licence.tier + 1}` : 'Pásmo nestanoveno'}
                </Badge>
              }
              price={
                s.licence.yearlyPriceCzk != null
                  ? `${czk(s.licence.yearlyPriceCzk)} / rok${s.licence.customPrice ? ' (individuální)' : ''}`
                  : null
              }
            >
              {s.licence.tierRange && (
                <p className="text-sm text-muted-foreground">
                  Pásmo pro obce {s.licence.tierRange} obyvatel
                  {s.licence.growthSteps > 0 && ' (růstové pásmo)'}
                  {s.licence.population != null && ` · obec má ${num(s.licence.population)} obyvatel`}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Aktivní uživatelé {num(s.licence.activeUsers)}
                {s.licence.includedUsers != null && ` z ${num(s.licence.includedUsers)} v ceně`} — přihlášení nebo na akci za
                posledních 90 dní.
              </p>
              {s.licence.nextTier != null && s.licence.nextTier !== s.licence.tier && (
                <p className="text-sm text-warning">
                  Od dalšího období pásmo {s.licence.nextTier + 1} (pro obce {s.licence.nextTierRange} obyvatel).
                </p>
              )}
              {!s.licence.tierManual && (
                <p className="text-xs text-muted-foreground">
                  Cena je pevná na celé období. Když počet aktivních uživatelů přesáhne 5 % obyvatel, obec přejde až
                  od dalšího období o jedno pásmo výš (oznámíme do 15. 11.). Uživatelé se nikdy neomezují.
                </p>
              )}
              {s.licence.inTrial && s.licence.trialEndsAt && (
                <p className="text-sm text-warning">Zkušební provoz do {lastDay(s.licence.trialEndsAt)}.</p>
              )}
              <p className="text-sm text-muted-foreground">
                Licenční období {date(s.licence.periodStart)} – {lastDay(s.licence.periodEnd)}
              </p>
              {s.licence.paidUntil && (
                <p className={`text-sm ${s.licence.lapsed ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {s.licence.lapsed
                    ? `Licence byla zaplacená do ${lastDay(s.licence.paidUntil)} a vypršela — nová roční kvóta SMS se nenačte, dokud ji neprodloužíte.`
                    : `Zaplaceno do ${lastDay(s.licence.paidUntil)}.`}
                </p>
              )}
            </Row>

            <Row
              icon={Mail}
              title="E-mailová upozornění"
              badge={<Badge variant="outline">V licenci</Badge>}
            >
              <p className="text-sm text-muted-foreground">
                Přihlášky, změny a zrušení akcí e-mailem.
              </p>
            </Row>

            <Row
              icon={MessageSquare}
              title="SMS"
              badge={
                <Badge variant="outline">
                  {s.sms.enabled ? `Balíček ${PACKAGE_LABELS[s.sms.package]}` : 'Neobjednáno'}
                </Badge>
              }
              price={
                s.sms.enabled && s.sms.yearlyPriceCzk != null
                  ? `${czk(s.sms.yearlyPriceCzk)} / rok`
                  : null
              }
            >
              {s.sms.enabled ? (
                <>
                  <Meter used={s.sms.usedParts} limit={s.sms.quota} />
                  <p className="text-sm text-muted-foreground">
                    V licenčním roce odesláno {num(s.sms.usedParts)} z {num(s.sms.quota)} SMS
                    {s.sms.overageParts > 0 &&
                      ` (z toho přečerpání ${num(s.sms.overageParts)})`}.{' '}
                    Zrušení akce, které začne, dokud zbývá aspoň 1 SMS, se rozešle až do stropu
                    {s.sms.hardLimit > s.sms.quota
                      ? ` přečerpání (nejvýš ${num(s.sms.hardLimit - s.sms.quota)} SMS nad kvótu, vyúčtují se jako přečerpání)`
                      : ' kvóty (přečerpání není povoleno)'}
                    . Potom upozornění chodí jen e-mailem a v aplikaci.
                  </p>
                  {s.sms.usedParts < s.sms.quota && (
                    <p className="text-sm text-muted-foreground">
                      Zbývá {num(s.sms.quota - s.sms.usedParts)} SMS.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Zrušení akce i na telefon — lidem, kteří si SMS zapnou.
                </p>
              )}
            </Row>

            <Row
              icon={Bot}
              title="Import akcí z webu"
              badge={
                <Badge variant="outline">
                  {s.scraping.enabled
                    ? `Balíček ${PACKAGE_LABELS[s.scraping.package]}`
                    : 'Neobjednáno'}
                </Badge>
              }
              price={
                s.scraping.enabled && s.scraping.yearlyPriceCzk != null
                  ? `${czk(s.scraping.yearlyPriceCzk)} / rok`
                  : null
              }
            >
              {s.scraping.enabled ? (
                <>
                  <Meter used={s.scraping.enabledSources} limit={s.scraping.maxSources} />
                  <p className="text-sm text-muted-foreground">
                    Zapnuté zdroje {s.scraping.enabledSources} z {s.scraping.maxSources}
                    {' '}· kontrola {s.scraping.frequency === 'twice_weekly' ? '2× týdně' : '1× týdně'},{' '}
                    {WEEKDAY_NAMES[s.scraping.slotDay - 1]} v {s.scraping.slotHour}:00
                  </p>
                  {s.scraping.freeThisYear && (
                    <p className="text-xs text-muted-foreground">Balíček S je první rok zdarma.</p>
                  )}
                  {s.scraping.cheaperPackage && (
                    <p className="text-xs text-warning">
                      Balíček {PACKAGE_LABELS[s.scraping.cheaperPackage]} by obci se stejným počtem zdrojů
                      vyšel levněji.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Akce z webu obce se samy načtou k převzetí.
                </p>
              )}
            </Row>

            {s.yearlyTotalCzk != null ? (
              <div className="border-t border-border pt-3 flex items-baseline justify-between gap-2">
                <p className="font-bold">Celkem</p>
                <p className="text-right">
                  <span className="font-bold tabular-nums">{czk(s.yearlyTotalCzk)} / rok</span>
                  {s.licence.implementationFeeCzk != null && (
                    <span className="block text-sm text-muted-foreground tabular-nums">
                      + implementace {czk(s.licence.implementationFeeCzk)} jednorázově
                    </span>
                  )}
                </p>
              </div>
            ) : (
              (!s.sms.enabled || !s.scraping.enabled) && (
                <p className="text-xs text-muted-foreground">
                  Neobjednanou službu nebo větší balíček vám zapne provozovatel Lonvity.
                </p>
              )
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
