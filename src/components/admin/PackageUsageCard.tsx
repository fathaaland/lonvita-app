'use client'

import { useEffect, useState } from 'react'
import { PieChart } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { getMunicipalityServices, getPackageUsage } from '@/integrations/payload/queries'
import type { MunicipalityServices } from '@/lib/services/municipality-services'
import type { PackageUsage, PackageUsageRow } from '@/lib/services/package-usage'

const num = (value: number) => value.toLocaleString('cs-CZ')
const date = (iso: string) => new Date(iso).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' })
const lastDay = (iso: string) => date(new Date(new Date(iso).getTime() - 1).toISOString())
const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)} %` : '—')

/** A share bar — of the package where it has a limit, of everyone's use where it hasn't. */
function Bar({ part, whole }: { part: number; whole: number }) {
  const width = whole > 0 ? Math.min(100, (part / whole) * 100) : 0
  return <Progress value={width} className="h-1.5" aria-hidden />
}

function Metric({
  label,
  value,
  detail,
  part,
  whole,
}: {
  label: string
  value: string
  detail?: string
  part: number
  whole: number
}) {
  return (
    <div className="space-y-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{value}</span>
      </div>
      <Bar part={part} whole={whole} />
      {detail && <p className="text-xs text-muted-foreground tabular-nums">{detail}</p>}
    </div>
  )
}

function UsageRow({
  row,
  usage,
  services,
}: {
  row: PackageUsageRow
  usage: PackageUsage
  services: MunicipalityServices | null
}) {
  const smsQuota = services?.sms.enabled ? services.sms.quota : 0
  const maxSources = services?.scraping.enabled ? services.scraping.maxSources : 0
  return (
    <li className="py-3 space-y-2">
      <div>
        <p className="font-semibold text-sm break-words">{row.name}</p>
        {row.ownerName && <p className="text-xs text-muted-foreground">{row.ownerName}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="SMS"
          value={num(row.smsParts)}
          detail={
            smsQuota > 0
              ? `${share(row.smsParts, smsQuota)} kvóty${row.smsOverageParts > 0 ? ` · přečerpáno ${num(row.smsOverageParts)}` : ''}`
              : row.smsParts > 0
                ? `${share(row.smsParts, usage.totals.smsParts)} všech SMS`
                : undefined
          }
          part={row.smsParts}
          whole={smsQuota > 0 ? smsQuota : usage.totals.smsParts}
        />
        <Metric
          label="Import pomocí AI"
          value={`${num(row.aiCalls)} čtení`}
          detail={
            row.aiCalls > 0
              ? `${share(row.aiCalls, usage.totals.aiCalls)} všech · ${num(row.aiRuns)} importů · ${num(row.aiTokens)} tokenů`
              : undefined
          }
          part={row.aiCalls}
          whole={usage.totals.aiCalls}
        />
        <Metric
          label="Zapnuté zdroje"
          value={num(row.enabledSources)}
          detail={
            maxSources > 0 && row.enabledSources > 0 ? `${share(row.enabledSources, maxSources)} balíčku` : undefined
          }
          part={row.enabledSources}
          whole={maxSources > 0 ? maxSources : usage.totals.enabledSources}
        />
      </div>
    </li>
  )
}

/**
 * Who of the obec used how much of the packages it bought for the year (api/municipalities/:id/
 * package-usage) — the obec itself and each organizer: SMS (against the quota), the AI reads of the
 * event import (as a share of everyone's), sources switched on (against the package). For the obec's
 * admins; what they do about someone's use is up to them.
 */
export function PackageUsageCard({ municipalityId }: { municipalityId: string }) {
  const [usage, setUsage] = useState<PackageUsage | null>(null)
  const [services, setServices] = useState<MunicipalityServices | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let current = true
    Promise.all([getPackageUsage(municipalityId), getMunicipalityServices(municipalityId).catch(() => null)])
      .then(([u, s]) => {
        if (!current) return
        setUsage(u)
        setServices(s)
        setFailed(false)
      })
      .catch(() => current && setFailed(true))
    return () => {
      current = false
    }
  }, [municipalityId])

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <PieChart className="h-5 w-5 text-primary" />
          <p className="font-bold">Kdo čerpá balíček obce</p>
        </div>
        {failed ? (
          <p className="text-sm text-muted-foreground">Čerpání se nepodařilo načíst.</p>
        ) : !usage ? (
          <p className="text-sm text-muted-foreground">Načítám…</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Licenční období {date(usage.periodStart)} – {lastDay(usage.periodEnd)}. SMS a import akcí mohou používat
              admini obce i schválení organizátoři — všichni čerpají ze stejného balíčku obce.
            </p>
            {usage.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Zatím nikdo nic nečerpal.</p>
            ) : (
              <>
                <p className="text-sm">
                  Celkem{' '}
                  <span className="font-semibold tabular-nums">
                    {num(usage.totals.smsParts)}
                    {services?.sms.enabled && ` z ${num(services.sms.quota)}`} SMS
                  </span>
                  {' · '}
                  <span className="font-semibold tabular-nums">{num(usage.totals.aiCalls)} čtení pomocí AI</span>
                  {' · '}
                  <span className="font-semibold tabular-nums">
                    {num(usage.totals.enabledSources)}
                    {services?.scraping.enabled && ` z ${num(services.scraping.maxSources)}`} zdrojů
                  </span>
                </p>
                <ul className="divide-y divide-border">
                  {usage.rows.map((row) => (
                    <UsageRow
                      key={`${row.kind}-${row.organizationId ?? ''}`}
                      row={row}
                      usage={usage}
                      services={services}
                    />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
