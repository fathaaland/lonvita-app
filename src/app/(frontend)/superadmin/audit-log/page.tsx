'use client'

import { Fragment, Suspense, useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Download, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { RequireAuth, RequireRole } from '@/components/RequireAuth'
import { PageHeader } from '@/components/PageHeader'
import { Loading } from '@/components/Loading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  auditCsvUrl,
  getAuditLog,
  type AuditFilterInput,
  type AuditRow,
} from '@/integrations/payload/compliance-queries'

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague',
    dateStyle: 'short',
    timeStyle: 'medium',
  })

const EMPTY: AuditFilterInput = { action: '', actor: '', target: '', outcome: '', from: '', to: '' }

function Detail({ row }: { row: AuditRow }) {
  return (
    <div className="grid gap-1 text-xs md:grid-cols-2">
      <p>
        <span className="text-muted-foreground">Cíl:</span> {row.targetCollection} #{row.targetId}
      </p>
      <p>
        <span className="text-muted-foreground">IP adresa:</span> {row.ipAddress ?? '—'}
      </p>
      <p className="md:col-span-2 break-all">
        <span className="text-muted-foreground">Prohlížeč:</span> {row.userAgent ?? '—'}
      </p>
      <p>
        <span className="text-muted-foreground">ID požadavku:</span> {row.correlationId ?? '—'}
      </p>
      {row.metadata != null && (
        <pre className="md:col-span-2 mt-1 max-h-72 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-snug">
          {JSON.stringify(row.metadata, null, 2)}
        </pre>
      )}
    </div>
  )
}

/**
 * The audit log for the platform's admins (vyhláška 409/2025 Sb. § 22) — who did what, when, from
 * where and how it ended, filtered and exported to CSV. Looking at it is itself recorded.
 */
function AuditLogContent() {
  const [draft, setDraft] = useState<AuditFilterInput>(EMPTY)
  const [filters, setFilters] = useState<AuditFilterInput>(EMPTY)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Awaited<ReturnType<typeof getAuditLog>> | null>(null)
  const [open, setOpen] = useState<number | null>(null)

  const load = useCallback((f: AuditFilterInput, p: number) => {
    setData(null)
    getAuditLog(f, p)
      .then(setData)
      .catch(() => toast.error('Audit log se nepodařilo načíst.'))
  }, [])

  useEffect(() => load(filters, page), [load, filters, page])

  const set = (key: keyof AuditFilterInput) => (value: string) => setDraft({ ...draft, [key]: value })
  const apply = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setFilters(draft)
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Audit log" back />
      <div className="px-4 py-5 space-y-4 max-w-6xl">
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
          <p>
            Záznamy nejde upravit ani smazat dřív než po 18 měsících (hlídá to databáze), každou noc se ukládá
            neměnná kopie mimo aplikaci. I toto prohlížení se zapisuje do audit logu.
          </p>
        </div>

        <Card>
          <CardContent className="p-4">
            <form onSubmit={apply} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
              <div className="space-y-1">
                <Label htmlFor="f-action">Akce</Label>
                <Input
                  id="f-action"
                  value={draft.action}
                  onChange={(e) => set('action')(e.target.value)}
                  placeholder="např. user-roles"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="f-actor">Kdo (e-mail)</Label>
                <Input id="f-actor" value={draft.actor} onChange={(e) => set('actor')(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="f-target">Cíl (kolekce)</Label>
                <Input
                  id="f-target"
                  value={draft.target}
                  onChange={(e) => set('target')(e.target.value)}
                  placeholder="např. municipalities"
                />
              </div>
              <div className="space-y-1">
                <Label>Výsledek</Label>
                <Select value={draft.outcome || 'all'} onValueChange={(v) => set('outcome')(v === 'all' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Vše</SelectItem>
                    <SelectItem value="success">Úspěch</SelectItem>
                    <SelectItem value="failure">Odmítnuto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="f-from">Od</Label>
                <Input id="f-from" type="date" value={draft.from} onChange={(e) => set('from')(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="f-to">Do</Label>
                <Input id="f-to" type="date" value={draft.to} onChange={(e) => set('to')(e.target.value)} />
              </div>
              <Button type="submit">Filtrovat</Button>
              <Button asChild variant="outline">
                <a href={auditCsvUrl(filters)} download>
                  <Download className="h-4 w-4" /> CSV (max. 10 000)
                </a>
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            {!data ? (
              <Loading />
            ) : data.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Žádné záznamy.</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-2">
                  {data.totalDocs.toLocaleString('cs-CZ')} záznamů · strana {data.page} z {data.totalPages}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1.5 pr-2 w-6" />
                        <th className="py-1.5 pr-3 font-medium">Kdy</th>
                        <th className="py-1.5 pr-3 font-medium">Akce</th>
                        <th className="py-1.5 pr-3 font-medium">Kdo</th>
                        <th className="py-1.5 pr-3 font-medium">Obec</th>
                        <th className="py-1.5 font-medium">Výsledek</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.rows.map((r) => (
                        <Fragment key={r.id}>
                          <tr
                            className="cursor-pointer hover:bg-muted/40"
                            onClick={() => setOpen(open === r.id ? null : r.id)}
                          >
                            <td className="py-2 pr-2">
                              {open === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </td>
                            <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{dateTime(r.at)}</td>
                            <td className="py-2 pr-3 font-mono text-xs">{r.action}</td>
                            <td className="py-2 pr-3 max-w-[14rem] truncate">{r.actor ?? 'systém'}</td>
                            <td className="py-2 pr-3 max-w-[10rem] truncate">{r.municipality ?? '—'}</td>
                            <td className="py-2">
                              {r.outcome === 'failure' ? (
                                <Badge variant="destructive">Odmítnuto</Badge>
                              ) : (
                                <Badge variant="outline">Úspěch</Badge>
                              )}
                            </td>
                          </tr>
                          {open === r.id && (
                            <tr>
                              <td />
                              <td colSpan={5} className="pb-3">
                                <Detail row={r} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-between mt-3">
                  <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>
                    Novější
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.page >= data.totalPages}
                    onClick={() => setPage(data.page + 1)}
                  >
                    Starší
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function AuditLogPage() {
  return (
    <RequireAuth>
      <RequireRole role="superadmin">
        <Suspense fallback={<Loading />}>
          <AuditLogContent />
        </Suspense>
      </RequireRole>
    </RequireAuth>
  )
}
