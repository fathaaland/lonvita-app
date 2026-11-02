'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Bot, Globe, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import {
  getImportOverview,
  runImportSource,
  setImportAiEnabled,
  setImportSourceEnabled,
  sourceActivity,
  type ImportOverview,
  type ImportOverviewMunicipality,
  type ImportSourceRow,
} from '@/integrations/payload/import-queries'
import { PayloadApiError } from '@/integrations/payload/client'
import { IMPORT_LIMITS } from '@/lib/import/contracts'
import { formatEventDateTime } from '@/lib/date'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Loading } from '@/components/Loading'
import Link from 'next/link'

/** While a source is being read somewhere, the tab looks again this often. */
const POLL_EVERY_MS = 10_000

const errorText = (error: unknown, fallback: string) =>
  error instanceof PayloadApiError && error.status < 500 ? error.message : fallback

const usd = (value: number) => `$${value.toFixed(2)}`

function SourceLine({ source, onChanged }: { source: ImportSourceRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const activity = sourceActivity(source)
  const failing = Boolean(source.last_error) && source.consecutive_failures > 0

  const act = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true)
    try {
      await action()
      onChanged()
    } catch (error) {
      toast.error(errorText(error, fallback))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex items-start gap-3 py-2.5">
      <Globe className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-sm font-semibold hover:underline break-all"
          >
            {source.label}
          </a>
          {!source.enabled && <Badge variant="secondary">Vypnuto</Badge>}
          {source.ignore_robots && <Badge variant="outline">Výjimka z robots.txt</Badge>}
          {failing && (
            <Badge variant="destructive">{source.consecutive_failures}× po sobě selhalo</Badge>
          )}
        </div>
        {activity ? (
          <p className="flex items-center gap-1.5 text-xs text-primary" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {activity === 'running' ? 'Prochází se…' : 'Ve frontě…'}
          </p>
        ) : source.last_error ? (
          <p className="text-xs text-destructive">
            {source.last_run_at ? `${formatEventDateTime(source.last_run_at)}: ` : ''}
            {source.last_error}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {source.last_run_at
              ? `Načteno ${formatEventDateTime(source.last_run_at)}${
                  source.last_found_count != null
                    ? ` — ${source.last_found_count} akcí na stránce`
                    : ''
                }`
              : 'Ještě nenačteno.'}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        disabled={busy || !source.enabled || Boolean(activity)}
        onClick={() => act(() => runImportSource(source.id), 'Zdroj se nepodařilo spustit.')}
        aria-label="Projít teď"
        title="Projít teď"
      >
        <RefreshCw className="h-4 w-4" />
      </Button>
      <Switch
        checked={source.enabled}
        disabled={busy}
        onCheckedChange={(enabled) =>
          act(() => setImportSourceEnabled(source.id, enabled), 'Zdroj se nepodařilo upravit.')
        }
        aria-label={source.enabled ? 'Vypnout zdroj' : 'Zapnout zdroj'}
      />
    </li>
  )
}

function MunicipalityImport({
  municipality,
  onChanged,
}: {
  municipality: ImportOverviewMunicipality
  onChanged: () => void
}) {
  const failing = municipality.sources.filter(
    (s) => s.last_error && s.consecutive_failures > 0,
  ).length

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-bold flex-1">{municipality.name}</p>
          {municipality.pending_candidates > 0 && (
            <Badge variant="secondary">K převzetí: {municipality.pending_candidates}</Badge>
          )}
          {failing > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" aria-hidden /> Selhávající zdroje: {failing}
            </Badge>
          )}
        </div>

        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">AI tento měsíc (náklad pro nás)</span>
          <span className="font-semibold">{usd(municipality.spent_usd)}</span>
        </div>
        <Link href={`/superadmin/obce/${municipality.id}`} className="text-xs underline text-muted-foreground">
          Balíček, log běhů a kontrola
        </Link>

        {municipality.sources.length > 0 ? (
          <ul className="divide-y divide-border">
            {municipality.sources.map((s) => (
              <SourceLine key={s.id} source={s} onChanged={onChanged} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Žádné zdroje — obec importuje jen ručně.</p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Importing events across the platform (docs/import-akci-z-webu.md): the AI switch, and per obec its
 * sources (being read, failing, let past robots.txt — paused or read now from here), what its AI
 * cost us this month, and what waits for its admins. Its package and limits are on its billing page.
 */
export function ImportAdminTab() {
  const [overview, setOverview] = useState<ImportOverview | null>(null)
  const [switching, setSwitching] = useState(false)

  const load = useCallback(async () => {
    try {
      setOverview(await getImportOverview())
    } catch (error) {
      toast.error(errorText(error, 'Přehled importu se nepodařilo načíst.'))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const active =
    overview?.municipalities.some((m) => m.sources.some((s) => sourceActivity(s))) ?? false
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => void load(), POLL_EVERY_MS)
    return () => clearInterval(timer)
  }, [active, load])

  if (!overview) return <Loading />

  const toggleAi = async (enabled: boolean) => {
    setSwitching(true)
    try {
      await setImportAiEnabled(enabled)
      toast.success(
        enabled ? 'AI zpracování je zapnuté.' : 'AI zpracování je vypnuté pro všechny obce.',
      )
      await load()
    } catch (error) {
      toast.error(errorText(error, 'Nastavení se nepodařilo uložit.'))
    } finally {
      setSwitching(false)
    }
  }

  const spent = overview.municipalities.reduce((sum, m) => sum + m.spent_usd, 0)
  const withImport = overview.municipalities.filter(
    (m) =>
      m.sources.length > 0 || m.spent_usd > 0 || m.pending_candidates > 0,
  )
  const rest = overview.municipalities.length - withImport.length

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-3">
            <Bot className="h-5 w-5 text-primary shrink-0" aria-hidden />
            <div className="flex-1">
              <p className="font-bold">Zpracování pomocí AI</p>
              <p className="text-xs text-muted-foreground">
                Vypnuté: weby i ruční importy se čtou jen z kalendářů iCal a strukturovaných dat,
                nic se neplatí. Použijte při výpadku nebo když náklady utíkají.
              </p>
            </div>
            <Switch
              checked={overview.ai_enabled}
              disabled={switching}
              onCheckedChange={toggleAi}
              aria-label={overview.ai_enabled ? 'Vypnout AI zpracování' : 'Zapnout AI zpracování'}
            />
          </div>
          <p className="text-sm">
            AI tento měsíc celkem: <span className="font-semibold">{usd(spent)}</span>
            <span className="text-muted-foreground">
              {' '}
              · běh se zastaví nad limitem tokenů (Balíčky a fakturace) · zdroj se po{' '}
              {IMPORT_LIMITS.failuresBeforePause} selháních po sobě sám vypne
            </span>
          </p>
        </CardContent>
      </Card>

      {withImport.map((m) => (
        <MunicipalityImport
          key={m.id}
          municipality={m}
          onChanged={() => void load()}
        />
      ))}
      {withImport.length === 0 && (
        <p className="text-sm text-muted-foreground">Zatím žádná obec import nepoužívá.</p>
      )}
      {rest > 0 && <p className="text-xs text-muted-foreground">Obce bez importu: {rest}.</p>}
    </div>
  )
}
