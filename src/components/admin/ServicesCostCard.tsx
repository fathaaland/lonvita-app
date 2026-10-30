'use client'

import { useEffect, useState } from 'react'
import { Bot, Mail, MessageSquare, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getMunicipalityServices } from '@/integrations/payload/queries'
import type {
  MunicipalityServices,
  MunicipalityServicesWithCosts,
} from '@/lib/services/municipality-services'

const czk = (value: number) => `${value.toLocaleString('cs-CZ')} Kč`
const usd = (value: number) => `$${value.toFixed(2)}`

const hasCosts = (s: MunicipalityServices): s is MunicipalityServicesWithCosts =>
  'spentUsd' in s.importAi

function ServiceRow({
  icon: Icon,
  title,
  enabled,
  priceCzk,
  children,
}: {
  icon: LucideIcon
  title: string
  enabled: boolean
  priceCzk: number | null
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">{title}</p>
          {enabled ? (
            <span className="text-sm font-semibold tabular-nums">
              {priceCzk ? `${czk(priceCzk)} / měs.` : 'v ceně'}
            </span>
          ) : (
            <Badge variant="outline">Neobjednáno</Badge>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * What the obec pays for and how much of it it has used this month (lib/services) — a flat price
 * per service, so the obec always knows what Lonvita costs it. A platform admin sees what the AI
 * actually cost us too. `refreshKey` loads it again after the services changed.
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

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          <p className="font-bold">Služby a náklady</p>
        </div>

        {failed ? (
          <p className="text-sm text-muted-foreground">Služby se nepodařilo načíst.</p>
        ) : !services ? (
          <p className="text-sm text-muted-foreground">Načítám…</p>
        ) : (
          <>
            <ServiceRow
              icon={Mail}
              title="E-mailová upozornění"
              enabled
              priceCzk={services.email.priceCzk}
            >
              <p className="text-sm text-muted-foreground mt-0.5">
                Přihlášky, změny a zrušení akcí e-mailem.
              </p>
            </ServiceRow>

            <ServiceRow
              icon={MessageSquare}
              title="SMS při zrušení akce"
              enabled={services.sms.enabled}
              priceCzk={services.sms.priceCzk}
            >
              <p className="text-sm text-muted-foreground mt-0.5">
                {services.sms.enabled
                  ? services.sms.monthlyLimit != null
                    ? `Tento měsíc odesláno ${services.sms.sentThisMonth} z ${services.sms.monthlyLimit} SMS.`
                    : `Tento měsíc odesláno ${services.sms.sentThisMonth} SMS.`
                  : 'Přihlášení dostanou zprávu o zrušení akce i na telefon.'}
              </p>
            </ServiceRow>

            <ServiceRow
              icon={Bot}
              title="Import akcí pomocí AI"
              enabled={services.importAi.enabled}
              priceCzk={services.importAi.priceCzk}
            >
              {services.importAi.enabled ? (
                <div className="mt-1.5 space-y-1">
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${services.importAi.usedPercent >= 90 ? 'bg-destructive' : 'bg-primary'}`}
                      style={{ width: `${services.importAi.usedPercent}%` }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Tento měsíc využito {services.importAi.usedPercent} % měsíčního limitu
                    {hasCosts(services) &&
                      ` · ${usd(services.importAi.spentUsd)} z ${usd(services.importAi.budgetUsd)}`}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-0.5">
                  Akce z webu obce se čtou jen z kalendářů iCal a strukturovaných dat. AI přečte i
                  běžné stránky a zpravodaje.
                </p>
              )}
            </ServiceRow>

            <div className="border-t border-border pt-3 flex items-baseline justify-between gap-2">
              <p className="font-bold">Celkem</p>
              <p className="text-right">
                <span className="font-bold tabular-nums">
                  {czk(services.monthlyTotalCzk)} / měs.
                </span>
                <span className="block text-sm text-muted-foreground tabular-nums">
                  {czk(services.monthlyTotalCzk * 12)} / rok
                </span>
              </p>
            </div>
            {(!services.sms.enabled || !services.importAi.enabled) && (
              <p className="text-xs text-muted-foreground">
                Neobjednanou službu vám zapneme na požádání u provozovatele Lonvity.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
