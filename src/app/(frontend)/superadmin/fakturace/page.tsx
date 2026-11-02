'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Download, Plus, Receipt, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { RequireAuth, RequireRole } from '@/components/RequireAuth'
import { PageHeader } from '@/components/PageHeader'
import { Loading } from '@/components/Loading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  billingCsvUrl,
  getBillingOverview,
  getStoredBillingCatalog,
  saveBillingCatalog,
  type BillingRow,
} from '@/integrations/payload/billing-queries'
import { PayloadApiError } from '@/integrations/payload/client'
import {
  catalogFrom,
  PACKAGE_KEYS,
  PACKAGE_LABELS,
  type BillingCatalog,
} from '@/lib/billing/catalog'
import { pragueMonthKey } from '@/lib/billing/period'

const num = (value: number | null) => (value == null ? '—' : value.toLocaleString('cs-CZ'))

/** A number input over one value of the price list — the text as typed, the number once it parses. */
function Amount({
  id,
  label,
  value,
  onChange,
  allowEmpty = false,
}: {
  id: string
  label?: string
  value: number | null
  onChange: (value: number | null) => void
  allowEmpty?: boolean
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => setText(value == null ? '' : String(value)), [value])
  return (
    <div className="space-y-1">
      {label && (
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </Label>
      )}
      <Input
        id={id}
        inputMode="decimal"
        value={text}
        placeholder={allowEmpty ? 'a víc' : undefined}
        onChange={(e) => {
          setText(e.target.value)
          const raw = e.target.value.replace(',', '.').replace(/\s/g, '')
          if (raw === '' && allowEmpty) onChange(null)
          else if (raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0)
            onChange(Number(raw))
        }}
        className="h-10"
      />
    </div>
  )
}

function CatalogEditor() {
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getStoredBillingCatalog()
      .then((c) => setCatalog(catalogFrom(c)))
      .catch(() => toast.error('Ceník se nepodařilo načíst.'))
  }, [])

  if (!catalog) return <Loading />

  const update = (patch: Partial<BillingCatalog>) => setCatalog({ ...catalog, ...patch })
  const tiers = catalog.licenceTiers

  const save = async () => {
    const openEnded = tiers.filter((t) => t.maxUsers == null).length
    if (openEnded !== 1 || tiers[tiers.length - 1].maxUsers != null) {
      toast.error('Poslední pásmo musí mít horní hranici prázdnou („a víc“), ostatní vyplněnou.')
      return
    }
    for (let i = 1; i < tiers.length - 1; i++) {
      if ((tiers[i].maxUsers ?? 0) <= (tiers[i - 1].maxUsers ?? 0)) {
        toast.error('Horní hranice pásem musí stoupat.')
        return
      }
    }
    setSaving(true)
    try {
      await saveBillingCatalog(catalog)
      toast.success('Ceník uložen.')
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status < 500
          ? error.message
          : 'Ceník se nepodařilo uložit.',
      )
    } finally {
      setSaving(false)
    }
  }

  const setSms = (
    k: (typeof PACKAGE_KEYS)[number],
    patch: Partial<BillingCatalog['smsPackages']['s']>,
  ) =>
    update({
      smsPackages: { ...catalog.smsPackages, [k]: { ...catalog.smsPackages[k], ...patch } },
    })
  const setScraping = (
    k: (typeof PACKAGE_KEYS)[number],
    patch: Partial<BillingCatalog['scrapingPackages']['s']>,
  ) =>
    update({
      scrapingPackages: {
        ...catalog.scrapingPackages,
        [k]: { ...catalog.scrapingPackages[k], ...patch },
      },
    })

  return (
    <Card>
      <CardContent className="p-4 space-y-5">
        <div>
          <p className="font-bold">Ceník balíčků</p>
          <p className="text-sm text-muted-foreground">
            Interní — obcím se ceny neukazují. Změna platí hned pro všechny obce bez individuální
            ceny a zapíše se do auditu.
          </p>
        </div>

        <div className="space-y-2">
          <p className="font-semibold text-sm">Licence podle počtu uživatelů (Kč/rok)</p>
          {tiers.map((t, i) => (
            <div key={i} className="grid grid-cols-[3rem_1fr_1fr_2.5rem] gap-2 items-end">
              <span className="text-sm text-muted-foreground pb-2.5">#{i}</span>
              <Amount
                id={`tier-max-${i}`}
                label={i === 0 ? 'Do uživatelů' : undefined}
                value={t.maxUsers}
                allowEmpty
                onChange={(v) =>
                  update({
                    licenceTiers: tiers.map((x, j) => (j === i ? { ...x, maxUsers: v } : x)),
                  })
                }
              />
              <Amount
                id={`tier-price-${i}`}
                label={i === 0 ? 'Cena Kč/rok' : undefined}
                value={t.yearlyPriceCzk}
                onChange={(v) =>
                  update({
                    licenceTiers: tiers.map((x, j) =>
                      j === i ? { ...x, yearlyPriceCzk: v ?? 0 } : x,
                    ),
                  })
                }
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10"
                disabled={tiers.length <= 1}
                aria-label="Odebrat pásmo"
                onClick={() => update({ licenceTiers: tiers.filter((_, j) => j !== i) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const last = tiers[tiers.length - 1]
              const before = tiers.slice(0, -1)
              const prevMax = before[before.length - 1]?.maxUsers ?? 0
              update({
                licenceTiers: [
                  ...before,
                  { maxUsers: prevMax + 200, yearlyPriceCzk: last.yearlyPriceCzk },
                  last,
                ],
              })
            }}
          >
            <Plus className="h-4 w-4" /> Přidat pásmo
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Amount
            id="impl-fee"
            label="Implementace (Kč, jednorázově)"
            value={catalog.implementationFeeCzk}
            onChange={(v) => update({ implementationFeeCzk: v ?? 0 })}
          />
          <Amount
            id="source-fee"
            label="Zřízení zdroje (Kč, jednorázově)"
            value={catalog.sourceSetupFeeCzk}
            onChange={(v) => update({ sourceSetupFeeCzk: v ?? 0 })}
          />
        </div>

        <div className="space-y-2">
          <p className="font-semibold text-sm">SMS balíčky (roční kvóta částí, Kč/rok)</p>
          {PACKAGE_KEYS.map((k) => (
            <div key={k} className="grid grid-cols-[3rem_1fr_1fr] gap-2 items-end">
              <span className="text-sm font-semibold pb-2.5">{PACKAGE_LABELS[k]}</span>
              <Amount
                id={`sms-quota-${k}`}
                label={k === 's' ? 'SMS za rok' : undefined}
                value={catalog.smsPackages[k].quota}
                onChange={(v) => setSms(k, { quota: v ?? 0 })}
              />
              <Amount
                id={`sms-price-${k}`}
                label={k === 's' ? 'Cena Kč/rok' : undefined}
                value={catalog.smsPackages[k].yearlyPriceCzk}
                onChange={(v) => setSms(k, { yearlyPriceCzk: v ?? 0 })}
              />
            </div>
          ))}
          <Amount
            id="sms-overage"
            label="Přečerpání (Kč za SMS)"
            value={catalog.smsOveragePriceCzk}
            onChange={(v) => update({ smsOveragePriceCzk: v ?? 0 })}
          />
        </div>

        <div className="space-y-2">
          <p className="font-semibold text-sm">Scraping balíčky (max. zdrojů, Kč/rok)</p>
          {PACKAGE_KEYS.map((k) => (
            <div key={k} className="grid grid-cols-[3rem_1fr_1fr] gap-2 items-end">
              <span className="text-sm font-semibold pb-2.5">{PACKAGE_LABELS[k]}</span>
              <Amount
                id={`scr-max-${k}`}
                label={k === 's' ? 'Zdrojů' : undefined}
                value={catalog.scrapingPackages[k].maxSources}
                onChange={(v) => setScraping(k, { maxSources: v ?? 0 })}
              />
              <Amount
                id={`scr-price-${k}`}
                label={k === 's' ? 'Cena Kč/rok' : undefined}
                value={catalog.scrapingPackages[k].yearlyPriceCzk}
                onChange={(v) => setScraping(k, { yearlyPriceCzk: v ?? 0 })}
              />
            </div>
          ))}
          <Amount
            id="max-tokens"
            label="Technický limit vstupních tokenů na běh (neúčtuje se)"
            value={catalog.maxInputTokensPerRun}
            onChange={(v) => update({ maxInputTokensPerRun: v ?? 0 })}
          />
        </div>

        <Button onClick={save} disabled={saving} className="w-full h-11">
          Uložit ceník
        </Button>
      </CardContent>
    </Card>
  )
}

function Overview() {
  const [month, setMonth] = useState(() => pragueMonthKey(new Date()))
  const [rows, setRows] = useState<BillingRow[] | null>(null)

  const load = useCallback((m: string) => {
    setRows(null)
    getBillingOverview(m)
      .then((r) => setRows(r.rows))
      .catch(() => toast.error('Přehled se nepodařilo načíst.'))
  }, [])

  useEffect(() => load(month), [load, month])

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-bold">Přehled obcí</p>
            <p className="text-sm text-muted-foreground">
              Podklad k ruční fakturaci — SMS a scraping za vybraný měsíc.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="month" className="text-xs text-muted-foreground">
                Měsíc
              </Label>
              <Input
                id="month"
                type="month"
                value={month}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
                className="h-10"
              />
            </div>
            <Button asChild variant="outline" className="h-10">
              <a href={billingCsvUrl(month)} download>
                <Download className="h-4 w-4" /> CSV
              </a>
            </Button>
          </div>
        </div>

        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žádné obce.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Obec</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Uživatelé</th>
                  <th className="py-1.5 pr-3 font-medium">Pásmo</th>
                  <th className="py-1.5 pr-3 font-medium">SMS</th>
                  <th className="py-1.5 pr-3 font-medium text-right">SMS měsíc / rok</th>
                  <th className="py-1.5 pr-3 font-medium">Scraping</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Běhy / tokeny</th>
                  <th className="py-1.5 font-medium text-right">Kč/rok</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.municipalityId}>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/superadmin/obce/${r.municipalityId}`}
                        className="font-semibold hover:underline"
                      >
                        {r.name}
                      </Link>
                      {r.billingStatus === 'suspended' && (
                        <Badge variant="destructive" className="ml-2">
                          Pozastaveno
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {num(r.snapshotUsers ?? r.activeUsers)}
                    </td>
                    <td className="py-2 pr-3">
                      {r.tier}
                      {r.tierManual && <span className="text-muted-foreground"> (ručně)</span>}
                    </td>
                    <td className="py-2 pr-3">{r.smsPackage ?? '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                      {num(r.smsPartsMonth)} / {num(r.smsPartsPeriod)}
                      {r.smsQuota != null && (
                        <span className="text-muted-foreground"> z {num(r.smsQuota)}</span>
                      )}
                      {r.smsOveragePartsMonth > 0 && (
                        <span className="block text-xs text-warning">
                          přečerpání {num(r.smsOveragePartsMonth)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {r.scrapingPackage
                        ? `${r.scrapingPackage} · ${r.enabledSources}/${r.maxSources}`
                        : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                      {num(r.runsMonth)} / {num(r.inputTokensMonth)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{num(r.yearlyTotalCzk)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Balíčky a fakturace (Balíčky služeb, 27. 10. 2026) — every obec's band, packages and use for a
 * month with its CSV, and the price list the platform sells from. Each obec's own packages are set
 * on its page (/superadmin/obce/:id).
 */
export default function BillingPage() {
  return (
    <RequireAuth>
      <RequireRole role="superadmin">
        <Suspense fallback={<Loading />}>
          <div className="animate-fade-in">
            <PageHeader title="Balíčky a fakturace" back />
            <div className="px-4 py-5 space-y-4 max-w-6xl">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Receipt className="h-4 w-4" /> Balíček konkrétní obce nastavíte kliknutím na její
                název.
              </div>
              <Overview />
              <div className="max-w-2xl">
                <CatalogEditor />
              </div>
            </div>
          </div>
        </Suspense>
      </RequireRole>
    </RequireAuth>
  )
}
