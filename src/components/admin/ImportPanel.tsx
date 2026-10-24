'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CalendarPlus,
  ExternalLink,
  FileUp,
  Globe,
  Loader2,
  RefreshCw,
  Type,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  addImportSource,
  approveImportCandidate,
  approveImportCandidates,
  decideSyncNotices,
  deleteImportSource,
  getImportRunByJob,
  getLatestSourceRun,
  importFromFile,
  importFromText,
  listImportSources,
  listPendingImportCandidates,
  listRunningManualImports,
  listSyncNotices,
  rejectImportCandidate,
  runImportSource,
  setImportSourceEnabled,
  setImportSourceIgnoreRobots,
  sourceActivity,
  type ImportCandidateRow,
  type ImportRunRow,
  type ImportSourceRow,
  type ImportSyncRow,
} from '@/integrations/payload/import-queries'
import { getEventCategories } from '@/integrations/payload/queries'
import { PayloadApiError } from '@/integrations/payload/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton'
import {
  IMPORT_LIMITS,
  IMPORT_WARNINGS,
  isReadyToApprove,
  ROBOTS_ALLOW_LINES,
  SYNC_FIELD_LABELS,
  SYNC_NOTICES,
} from '@/lib/import/contracts'
import { formatEventDate, formatEventDateTime } from '@/lib/date'

/** While anything is being read, the panel looks again this often. */
const POLL_EVERY_MS = 5_000
/** After the admin asks for a read the panel keeps looking at least this long — until the worker
 * has picked it up and the source says so. */
const POLL_GRACE_MS = 20_000

/** A pasted program or a file sent off for reading — watched until its run is over. */
type ManualJob = { key: string; jobId: string | null; label: string; since: number }

const newCountLabel = (n: number) =>
  n === 1 ? '1 nová akce' : n >= 2 && n <= 4 ? `${n} nové akce` : `${n} nových akcí`

/** How a source's read went, once the panel saw it finish. */
async function announceSourceRun(source: ImportSourceRow) {
  const run = await getLatestSourceRun(source.id).catch(() => null)
  if (!run || run.status === 'running' || run.status === 'skipped') return
  if (run.status === 'failed') {
    toast.error(`${source.label}: ${run.error ?? 'Zdroj se nepodařilo načíst.'}`)
  } else if (run.status === 'unchanged') {
    toast.success(`Hotovo — ${source.label}: od minula beze změny.`)
  } else {
    toast.success(
      `Hotovo — ${source.label}: na stránce ${run.found ?? 0} akcí, k převzetí ${newCountLabel(run.created ?? 0)}.`,
    )
  }
}

/** How a manual import went, once its run is over. */
function announceManualRun(job: ManualJob, run: ImportRunRow) {
  if (run.status === 'failed') toast.error(`${job.label}: ${run.error ?? 'Import se nepodařil.'}`)
  else if ((run.created ?? 0) > 0)
    toast.success(`Hotovo — ${job.label}: k převzetí ${newCountLabel(run.created!)}.`)
  else toast.success(`Hotovo — ${job.label}: žádné nové akce.`)
}

/** A spinner with what's going on — while a source or an import is being read. */
function Working({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-primary mt-0.5" role="status">
      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
      {children}
    </p>
  )
}

const errorText = (error: unknown, fallback: string) =>
  error instanceof PayloadApiError && error.status < 500 ? error.message : fallback

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const FORMAT_LABELS: Record<string, string> = {
  ical: 'kalendář iCal',
  jsonld: 'strukturovaná data',
  html: 'webová stránka',
  feed: 'RSS',
  pdf: 'PDF',
  image: 'obrázek',
}

/** For the web's operator — what to add to robots.txt, and why. */
const robotsRequestText = (url: string) => `Dobrý den,

prosíme o úpravu souboru robots.txt na webu ${hostOf(url)}. Akce z kalendáře na webu přebíráme do aplikace Lonvita (https://lonvita.cz), kde je obyvatelé najdou a mohou se na ně přihlásit. Soubor robots.txt teď pouští jen vyhledávače, takže stránku s akcemi číst nemůžeme.

Stačí do robots.txt přidat tyto dva řádky:

${ROBOTS_ALLOW_LINES}

Lonvita stránku s akcemi kontroluje jednou denně a představuje se jako LonvitaBot.

Děkujeme.`

/**
 * A source the web's robots.txt keeps out: the obec may let the import in past it when the web is
 * its own (EventSources.ignoreRobots — kept with who and when), and either way can ask whoever
 * runs the web to let LonvitaBot in for good.
 */
function RobotsBlocked({
  source,
  onChanged,
  onQueued,
}: {
  source: ImportSourceRow
  onChanged: () => void
  onQueued: () => void
}) {
  const [ours, setOurs] = useState(false)
  const [busy, setBusy] = useState(false)

  const waive = async () => {
    setBusy(true)
    try {
      await setImportSourceIgnoreRobots(source.id, true)
      toast.success('Povoleno — web se prochází, nové akce se tu objeví za chvíli.')
      onQueued()
      onChanged()
    } catch (error) {
      toast.error(errorText(error, 'Výjimku se nepodařilo uložit.'))
    } finally {
      setBusy(false)
    }
  }

  const copyRequest = async () => {
    try {
      await navigator.clipboard.writeText(robotsRequestText(source.url))
      toast.success('Žádost je zkopírovaná — vložte ji do e-mailu správci webu.')
    } catch {
      toast.error('Zkopírovat se nepodařilo.')
    }
  }

  return (
    <div className="mt-2 space-y-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
      <p className="text-muted-foreground">
        Web automatické čtení zakazuje v souboru robots.txt. Často jde o výchozí nastavení od
        dodavatele webu, které nikdo nezměnil.
      </p>
      <div className="space-y-2">
        <p className="font-semibold">Je to web vaší obce?</p>
        <label className="flex items-start gap-2">
          <Checkbox
            checked={ours}
            onCheckedChange={(v) => setOurs(v === true)}
            className="mt-0.5"
          />
          <span>Web provozuje naše obec a souhlasíme, aby ho Lonvita četla i přes robots.txt.</span>
        </label>
        <Button size="sm" onClick={waive} disabled={!ours || busy}>
          Povolit a projít
        </Button>
      </div>
      <div className="space-y-2">
        <p className="text-muted-foreground">
          Trvalé řešení (i pro weby, které obec neprovozuje): požádejte správce webu, ať do
          robots.txt přidá:
        </p>
        <pre className="rounded bg-background px-2 py-1 text-xs">{ROBOTS_ALLOW_LINES}</pre>
        <Button size="sm" variant="outline" onClick={copyRequest}>
          Zkopírovat žádost pro správce webu
        </Button>
      </div>
    </div>
  )
}

function SourceRow({
  source,
  activity,
  onChanged,
  onQueued,
}: {
  source: ImportSourceRow
  /** Being read now, or waiting for the worker (sourceActivity). */
  activity: 'running' | 'queued' | null
  onChanged: () => void
  onQueued: () => void
}) {
  const [busy, setBusy] = useState(false)

  const toggle = async (enabled: boolean) => {
    setBusy(true)
    try {
      await setImportSourceEnabled(source.id, enabled)
      if (enabled) onQueued()
      onChanged()
    } catch (error) {
      toast.error(errorText(error, 'Zdroj se nepodařilo upravit.'))
    } finally {
      setBusy(false)
    }
  }

  const run = async () => {
    setBusy(true)
    try {
      await runImportSource(source.id)
      onQueued()
    } catch (error) {
      toast.error(errorText(error, 'Zdroj se nepodařilo spustit.'))
    } finally {
      setBusy(false)
    }
  }

  const stopIgnoringRobots = async () => {
    setBusy(true)
    try {
      await setImportSourceIgnoreRobots(source.id, false)
      onChanged()
    } catch (error) {
      toast.error(errorText(error, 'Zdroj se nepodařilo upravit.'))
    } finally {
      setBusy(false)
    }
  }

  const status = activity
    ? null
    : !source.last_run_at
      ? 'Ještě nenačteno.'
      : source.last_error
      ? null
      : `Načteno ${formatEventDateTime(source.last_run_at)}${source.format ? ` (${FORMAT_LABELS[source.format] ?? source.format})` : ''}${
          source.last_found_count != null ? ` — na stránce ${source.last_found_count} akcí` : ''
        }`

  return (
    <li className="flex items-start gap-3 py-3">
      <Globe className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex-1 min-w-0">
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="font-semibold hover:underline break-all"
        >
          {source.label}
        </a>
        {activity === 'running' && <Working>Prochází se — může to trvat pár minut…</Working>}
        {activity === 'queued' && <Working>Ve frontě, za chvíli se začne procházet…</Working>}
        {status && <p className="text-xs text-muted-foreground mt-0.5">{status}</p>}
        {source.last_error && !activity && (
          <p className="text-xs text-destructive mt-0.5">
            {source.last_run_at ? `${formatEventDateTime(source.last_run_at)}: ` : ''}
            {source.last_error}
          </p>
        )}
        {source.ignore_robots && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Čte se i přes robots.txt — web provozuje obec
            {source.ignore_robots_at
              ? ` (povoleno ${formatEventDate(source.ignore_robots_at)})`
              : ''}
            .{' '}
            <button
              type="button"
              className="underline hover:text-foreground"
              onClick={stopIgnoringRobots}
              disabled={busy}
            >
              Zrušit
            </button>
          </p>
        )}
        {source.last_error_code === 'robots_disallowed' && !source.ignore_robots && !activity && (
          <RobotsBlocked source={source} onChanged={onChanged} onQueued={onQueued} />
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={run}
        disabled={busy || !source.enabled || Boolean(activity)}
        aria-label="Projít teď"
        title="Projít teď"
      >
        <RefreshCw className="h-4 w-4" />
      </Button>
      <Switch
        checked={source.enabled}
        onCheckedChange={toggle}
        disabled={busy}
        aria-label={source.enabled ? 'Vypnout zdroj' : 'Zapnout zdroj'}
      />
      <ConfirmDeleteButton
        title="Odebrat zdroj?"
        description="Akce, které už jste převzali, zůstanou. Ty, které čekají na převzetí, zůstanou ve frontě."
        onConfirm={async () => {
          await deleteImportSource(source.id)
          onChanged()
        }}
      />
    </li>
  )
}

function CandidateRow({
  candidate,
  categoryNames,
  onDecided,
}: {
  candidate: ImportCandidateRow
  categoryNames: Map<string, string>
  onDecided: () => void
}) {
  const [busy, setBusy] = useState(false)
  const ready = isReadyToApprove(candidate.warnings)

  const decide = async (approve: boolean) => {
    setBusy(true)
    try {
      if (approve) {
        await approveImportCandidate(candidate.id)
        toast.success(`Akce „${candidate.title}“ je v Lonvitě.`)
      } else {
        await rejectImportCandidate(candidate.id)
      }
      onDecided()
    } catch (error) {
      toast.error(
        errorText(error, approve ? 'Akci se nepodařilo převzít.' : 'Akci se nepodařilo zamítnout.'),
      )
    } finally {
      setBusy(false)
    }
  }

  const when = candidate.time_known
    ? formatEventDateTime(candidate.starts_at)
    : formatEventDate(candidate.starts_at)
  const origin =
    candidate.origin === 'text'
      ? 'vložený text'
      : candidate.origin === 'file'
        ? (candidate.origin_label ?? 'soubor')
        : hostOf(candidate.origin_label ?? '')

  return (
    <li className="py-3 space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="font-semibold">{candidate.title}</p>
        <p className="text-sm text-muted-foreground">{when}</p>
      </div>
      <p className="text-sm">
        {candidate.location_text ?? <span className="text-muted-foreground">Místo neuvedeno</span>}
      </p>
      {candidate.category_ids.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {candidate.category_ids
            .map((id) => categoryNames.get(id))
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {candidate.warnings.length > 0 && (
        <ul className="space-y-0.5">
          {candidate.warnings.map((w) => (
            <li
              key={w}
              className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
              <span>
                {IMPORT_WARNINGS[w] ?? w}
                {w === 'possible_duplicate' && candidate.duplicate_of && (
                  <>
                    {' '}
                    <Link
                      href={`/akce/${candidate.duplicate_of}`}
                      className="underline"
                      target="_blank"
                    >
                      Zobrazit akci
                    </Link>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {ready && (
          <Button size="sm" onClick={() => decide(true)} disabled={busy}>
            Převzít
          </Button>
        )}
        <Button size="sm" variant={ready ? 'outline' : 'default'} asChild>
          <Link href={`/import/${candidate.id}`}>
            {ready ? 'Upravit a převzít' : 'Doplnit a převzít'}
          </Link>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => decide(false)} disabled={busy}>
          Zamítnout
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          Zdroj: {origin}
          {candidate.detail_url && (
            <>
              {' · '}
              <a
                href={candidate.detail_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-0.5 underline"
              >
                detail <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </>
          )}
        </span>
      </div>
    </li>
  )
}

/** A taken-over event its source changed in a way the import left to the owner (lib/import/sync). */
function SyncRow({ row, onDecided }: { row: ImportSyncRow; onDecided: () => void }) {
  const [busy, setBusy] = useState(false)
  const canApply = row.notices.some((n) => n.code === 'changed' || n.code === 'not_applied')

  const decide = async (action: 'apply' | 'dismiss') => {
    setBusy(true)
    try {
      await decideSyncNotices(row.id, action)
      if (action === 'apply') toast.success(`Akce „${row.title}“ je upravená podle webu.`)
      onDecided()
    } catch (error) {
      toast.error(errorText(error, 'Změnu se nepodařilo uložit.'))
    } finally {
      setBusy(false)
    }
  }

  const when = row.time_known ? formatEventDateTime(row.starts_at) : formatEventDate(row.starts_at)
  return (
    <li className="py-3 space-y-1.5">
      <p className="font-semibold">{row.title}</p>
      <ul className="space-y-0.5">
        {row.notices.map((n) => (
          <li
            key={n.code}
            className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
          >
            <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
            <span>
              {SYNC_NOTICES[n.code] ?? n.code}
              {n.fields &&
                n.fields.length > 0 &&
                ` (${n.fields.map((f) => SYNC_FIELD_LABELS[f] ?? f).join(', ')})`}
            </span>
          </li>
        ))}
      </ul>
      {canApply && (
        <p className="text-xs text-muted-foreground">
          Na webu teď: {when} · {row.location_text ?? 'místo neuvedeno'}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {canApply && (
          <Button size="sm" onClick={() => decide('apply')} disabled={busy}>
            Převzít z webu
          </Button>
        )}
        {row.event_id && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/upravit/${row.event_id}`}>Upravit akci</Link>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => decide('dismiss')} disabled={busy}>
          Beru na vědomí
        </Button>
        {row.detail_url && (
          <a
            href={row.detail_url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-0.5 text-xs text-muted-foreground underline ml-auto"
          >
            na webu <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </div>
    </li>
  )
}

/**
 * "Import akcí" (docs/import-akci-z-webu.md) of an obec, in its dashboard: the web pages and
 * calendars its events are read from each night, the events found — none of which reaches Lonvita
 * until an admin takes it over — and the taken-over ones whose source changed in a way the import
 * left to the admins. The obec also imports from pasted text or a file.
 */
export function ImportPanel({
  municipalityId,
  onPendingCountChange,
}: {
  municipalityId: string
  onPendingCountChange?: (n: number) => void
}) {
  const [sources, setSources] = useState<ImportSourceRow[]>([])
  const [candidates, setCandidates] = useState<ImportCandidateRow[]>([])
  const [syncRows, setSyncRows] = useState<ImportSyncRow[]>([])
  const [categoryNames, setCategoryNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [url, setUrl] = useState('')
  const [consent, setConsent] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'source' | 'text' | 'file' | 'bulk' | null>(null)
  const [manualJobs, setManualJobs] = useState<ManualJob[]>([])
  const [runningManual, setRunningManual] = useState<ImportRunRow[]>([])
  const pollUntil = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  /** What each source was up to at the last look — a read that just ended is announced. */
  const lastActivity = useRef(new Map<string, 'running' | 'queued' | null>())

  const load = useCallback(async () => {
    const [s, c, r, m] = await Promise.all([
      listImportSources(municipalityId),
      listPendingImportCandidates(municipalityId),
      listSyncNotices(municipalityId),
      listRunningManualImports(municipalityId).catch(() => []),
    ])
    for (const source of s) {
      const now = sourceActivity(source)
      if (lastActivity.current.get(source.id) && !now) void announceSourceRun(source)
      lastActivity.current.set(source.id, now)
    }
    setSources(s)
    setCandidates(c)
    setSyncRows(r)
    setRunningManual(m)
    onPendingCountChange?.(c.length + r.length)
    setLoading(false)
  }, [municipalityId, onPendingCountChange])

  useEffect(() => {
    load().catch(() => setLoading(false))
    getEventCategories().then((cats) => setCategoryNames(new Map(cats.map((c) => [c.id, c.name]))))
  }, [load])

  /** The manual imports whose run is over — announced and let go. */
  const checkManualJobs = useCallback(async () => {
    if (manualJobs.length === 0) return
    const stale = Date.now() - IMPORT_LIMITS.runStaleMinutes * 60_000
    const done = new Set<string>()
    await Promise.all(
      manualJobs.map(async (job) => {
        const run = job.jobId ? await getImportRunByJob(job.jobId).catch(() => null) : null
        if (run && run.status !== 'running') {
          announceManualRun(job, run)
          done.add(job.key)
        } else if (job.since < stale) {
          done.add(job.key)
        }
      }),
    )
    if (done.size > 0) setManualJobs((jobs) => jobs.filter((j) => !done.has(j.key)))
  }, [manualJobs])

  const active =
    sources.some((s) => sourceActivity(s)) || manualJobs.length > 0 || runningManual.length > 0

  useEffect(() => {
    const timer = setInterval(() => {
      if (!active && Date.now() >= pollUntil.current) return
      load().catch(() => {})
      void checkManualJobs()
    }, POLL_EVERY_MS)
    return () => clearInterval(timer)
  }, [load, active, checkManualJobs])

  const startPolling = () => {
    pollUntil.current = Date.now() + POLL_GRACE_MS
    load().catch(() => {})
  }

  const watchManual = (jobId: string | null, label: string) => {
    setManualJobs((jobs) => [
      ...jobs,
      { key: `${Date.now()}-${Math.random()}`, jobId, label, since: Date.now() },
    ])
    startPolling()
  }

  const addSource = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim() || !consent) return
    setBusy('source')
    try {
      await addImportSource(municipalityId, url.trim())
      setUrl('')
      setConsent(false)
      toast.success('Zdroj přidán — průběh vidíte u něj.')
      startPolling()
    } catch (error) {
      toast.error(errorText(error, 'Zdroj se nepodařilo přidat.'))
    } finally {
      setBusy(null)
    }
  }

  const submitText = async () => {
    setBusy('text')
    try {
      const { jobId } = await importFromText(municipalityId, text)
      setText('')
      watchManual(jobId, 'Vložený text')
    } catch (error) {
      toast.error(errorText(error, 'Text se nepodařilo odeslat.'))
    } finally {
      setBusy(null)
    }
  }

  const submitFile = async (file: File | undefined) => {
    if (!file) return
    setBusy('file')
    try {
      const { jobId } = await importFromFile(municipalityId, file)
      watchManual(jobId, `Soubor „${file.name}“`)
    } catch (error) {
      toast.error(errorText(error, 'Soubor se nepodařilo nahrát.'))
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const ready = candidates.filter((c) => isReadyToApprove(c.warnings))
  const approveReady = async () => {
    setBusy('bulk')
    try {
      const results = await approveImportCandidates(ready.slice(0, 50).map((c) => c.id))
      const done = results.filter((r) => r.eventId).length
      const failed = results.filter((r) => r.error)
      if (done > 0) toast.success(`Převzato akcí: ${done}.`)
      if (failed.length > 0) toast.error(`${failed.length} akcí převzít nešlo: ${failed[0].error}`)
      await load()
    } catch (error) {
      toast.error(errorText(error, 'Akce se nepodařilo převzít.'))
    } finally {
      setBusy(null)
    }
  }

  if (loading) return null

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            <p className="font-bold">Zdroje akcí</p>
          </div>
          <p className="text-sm text-muted-foreground">
            Vložte odkaz na stránku, kde obec (nebo kulturní dům, spolek…) zveřejňuje program akcí —
            třeba „Kalendář akcí“ na webu obce nebo veřejný Google Kalendář. Lonvita ji každou noc
            zkontroluje, jednou týdně projde celou a nové akce vám nabídne k převzetí. Akce, které
            už jste převzali, upraví podle webu, pokud jste je v Lonvitě neměnili. Facebook projít
            nejde.
          </p>
          <form onSubmit={addSource} className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.obec.cz/kalendar-akci"
                className="h-11"
                aria-label="Adresa stránky s akcemi"
              />
              <Button
                type="submit"
                className="h-11 shrink-0"
                disabled={busy === 'source' || !url.trim() || !consent}
              >
                Přidat
              </Button>
            </div>
            <label className="flex items-start gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={consent}
                onCheckedChange={(v) => setConsent(v === true)}
                className="mt-0.5"
              />
              <span>Web provozujeme my, nebo nám jeho provozovatel převzetí akcí dovolil.</span>
            </label>
          </form>
          {sources.length > 0 && (
            <ul className="divide-y divide-border">
              {sources.map((s) => (
                <SourceRow
                  key={s.id}
                  source={s}
                  activity={sourceActivity(s)}
                  onChanged={() => load()}
                  onQueued={startPolling}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Type className="h-5 w-5 text-primary" />
            <p className="font-bold">Jednorázový import</p>
          </div>
          <p className="text-sm text-muted-foreground">
            Program, který na webu není — z e-mailu, zpravodaje, plakátu. Vložte text, nebo nahrajte
            PDF či fotku (do 4 MB).
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={IMPORT_LIMITS.textMaxChars}
            placeholder="Např. „So 14. 11. v 19:00 – Martinská zábava, sokolovna, vstupné 150 Kč…“"
            className="min-h-28"
            aria-label="Text programu"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={submitText} disabled={busy === 'text' || text.trim().length < 20}>
              Načíst akce z textu
            </Button>
            <Button
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={busy === 'file'}
              className="gap-2"
            >
              <FileUp className="h-4 w-4" />
              {busy === 'file' ? 'Nahrávám…' : 'Nahrát PDF nebo fotku'}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => submitFile(e.target.files?.[0])}
            />
          </div>
          {manualJobs.map((job) => (
            <Working key={job.key}>{job.label} se zpracovává — může to trvat pár minut…</Working>
          ))}
          {manualJobs.length === 0 && runningManual.length > 0 && (
            <Working>Zpracovává se dříve spuštěný import…</Working>
          )}
        </CardContent>
      </Card>

      {syncRows.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-primary" />
              <p className="font-bold">Změny u převzatých akcí ({syncRows.length})</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Web akci změnil a Lonvita ji sama neupravila — buď jste ji tu mezitím změnili, nebo
              změna potřebuje vaše doplnění. Zrušit akci kvůli webu musíte vždy sami.
            </p>
            <ul className="divide-y divide-border">
              {syncRows.map((r) => (
                <SyncRow key={r.id} row={r} onDecided={() => load()} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-primary" />
            <p className="font-bold flex-1">
              Akce k převzetí {candidates.length > 0 && `(${candidates.length})`}
            </p>
            {ready.length > 1 && (
              <Button size="sm" onClick={approveReady} disabled={busy === 'bulk'}>
                Převzít připravené ({Math.min(ready.length, 50)})
              </Button>
            )}
          </div>
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Teď tu nic nečeká. Nalezené akce se tu objeví — do Lonvity se dostanou, až je
              převezmete.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Převzatá akce se založí za obec, s neomezenou kapacitou a přihlašováním bez
                schvalování — před převzetím to můžete změnit v „Upravit a převzít“.
              </p>
              <ul className="divide-y divide-border">
                {candidates.map((c) => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    categoryNames={categoryNames}
                    onDecided={() => load()}
                  />
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
