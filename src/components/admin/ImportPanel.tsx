'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CalendarPlus,
  ExternalLink,
  FileUp,
  Globe,
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
  importFromFile,
  importFromText,
  listImportSources,
  listPendingImportCandidates,
  listSyncNotices,
  rejectImportCandidate,
  runImportSource,
  setImportSourceEnabled,
  type ImportCandidateRow,
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
  SYNC_FIELD_LABELS,
  SYNC_NOTICES,
} from '@/lib/import/contracts'
import { formatEventDate, formatEventDateTime } from '@/lib/date'

/** After the admin asks for a read, the panel looks for its results this long. */
const POLL_FOR_MS = 3 * 60 * 1000
const POLL_EVERY_MS = 10_000

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

function SourceRow({
  source,
  onChanged,
  onQueued,
}: {
  source: ImportSourceRow
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
      toast.success('Zdroj se prochází — nové akce se tu objeví za chvíli.')
      onQueued()
    } catch (error) {
      toast.error(errorText(error, 'Zdroj se nepodařilo spustit.'))
    } finally {
      setBusy(false)
    }
  }

  const status = !source.last_run_at
    ? 'Čeká na první načtení…'
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
        {status && <p className="text-xs text-muted-foreground mt-0.5">{status}</p>}
        {source.last_error && (
          <p className="text-xs text-destructive mt-0.5">
            {source.last_run_at ? `${formatEventDateTime(source.last_run_at)}: ` : ''}
            {source.last_error}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={run}
        disabled={busy || !source.enabled}
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
  const pollUntil = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const [s, c, r] = await Promise.all([
      listImportSources(municipalityId),
      listPendingImportCandidates(municipalityId),
      listSyncNotices(municipalityId),
    ])
    setSources(s)
    setCandidates(c)
    setSyncRows(r)
    onPendingCountChange?.(c.length + r.length)
    setLoading(false)
  }, [municipalityId, onPendingCountChange])

  useEffect(() => {
    load().catch(() => setLoading(false))
    getEventCategories().then((cats) => setCategoryNames(new Map(cats.map((c) => [c.id, c.name]))))
  }, [load])

  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() < pollUntil.current) load().catch(() => {})
    }, POLL_EVERY_MS)
    return () => clearInterval(timer)
  }, [load])

  const startPolling = () => {
    pollUntil.current = Date.now() + POLL_FOR_MS
  }

  const addSource = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim() || !consent) return
    setBusy('source')
    try {
      await addImportSource(municipalityId, url.trim())
      setUrl('')
      setConsent(false)
      toast.success('Zdroj přidán — prochází se, nové akce se tu objeví za chvíli.')
      startPolling()
      await load()
    } catch (error) {
      toast.error(errorText(error, 'Zdroj se nepodařilo přidat.'))
    } finally {
      setBusy(null)
    }
  }

  const submitText = async () => {
    setBusy('text')
    try {
      await importFromText(municipalityId, text)
      setText('')
      toast.success('Text se zpracovává — akce se tu objeví za chvíli a dáme vám vědět.')
      startPolling()
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
      await importFromFile(municipalityId, file)
      toast.success('Soubor se zpracovává — akce se tu objeví za chvíli a dáme vám vědět.')
      startPolling()
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
                <SourceRow key={s.id} source={s} onChanged={() => load()} onQueued={startPolling} />
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
