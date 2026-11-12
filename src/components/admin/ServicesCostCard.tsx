'use client'

import { useEffect, useState } from 'react'
import { Bot, Mail, MessageSquare, ShieldCheck, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getMunicipalityServices } from '@/integrations/payload/queries'
import { PACKAGE_LABELS } from '@/lib/billing/catalog'
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
    <div className="h-2 rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full ${share >= 100 ? 'bg-destructive' : share >= 80 ? 'bg-warning' : 'bg-primary'}`}
        style={{ width: `${share}%` }}
      />
    </div>
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
          {s?.billingStatus === 'suspended' && <Badge variant="destructive">Pozastaveno</Badge>}
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
              </p>
            )}
            <Row
              icon={ShieldCheck}
              title="Licence"
              badge={<Badge variant="outline">Pásmo {s.licence.tier}</Badge>}
              price={
                s.licence.yearlyPriceCzk != null
                  ? `${czk(s.licence.yearlyPriceCzk)} / rok${s.licence.customPrice ? ' (individuální)' : ''}`
                  : null
              }
            >
              <p className="text-sm text-muted-foreground">
                {num(s.licence.activeUsers)} uživatelů obce · pásmo pro {s.licence.tierRange}{' '}
                uživatelů
              </p>
              <p className="text-sm text-muted-foreground">
                Licenční období {date(s.licence.periodStart)} – {lastDay(s.licence.periodEnd)}
              </p>
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
                    {s.sms.overageAllowed
                      ? 'Po vyčerpání se posílá dál jako přečerpání.'
                      : 'Po vyčerpání jde další upozornění jen e-mailem a v aplikaci.'}
                  </p>
                  {s.sms.usedParts < s.sms.quota && (
                    <p className="text-sm text-muted-foreground">
                      Zbývá {num(s.sms.quota - s.sms.usedParts)} SMS. Zrušení nebo změna akce se
                      rozešle všem, i když zbytek nestačí — přebytek se vyúčtuje jako přečerpání.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Zrušení či změna akce a připomínka i na telefon — lidem, kteří si SMS zapnou.
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
                    {s.scraping.extraSources > 0 &&
                      ` (balíček ${s.scraping.packageMaxSources} + ${s.scraping.extraSources} navíc)`}{' '}
                    · kontrola {s.scraping.frequency === 'twice_weekly' ? '2× týdně' : '1× týdně'},{' '}
                    {WEEKDAY_NAMES[s.scraping.slotDay - 1]} v {s.scraping.slotHour}:00
                  </p>
                  {s.scraping.yearlyPriceCzk != null &&
                    (s.scraping.extraSources > 0 || s.scraping.frequency === 'twice_weekly') && (
                      <p className="text-xs text-muted-foreground tabular-nums">
                        Balíček {czk(s.scraping.packagePriceCzk ?? 0)}
                        {s.scraping.extraSources > 0 &&
                          ` + ${s.scraping.extraSources} zdroj(e) navíc ${czk(s.scraping.extraSourcesPriceCzk ?? 0)}`}
                        {s.scraping.frequency === 'twice_weekly' &&
                          ` + 2× týdně ${czk(s.scraping.frequencyPriceCzk ?? 0)}`}
                      </p>
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
