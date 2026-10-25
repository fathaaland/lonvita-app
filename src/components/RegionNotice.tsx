'use client'

import { useId, useState } from 'react'
import { ChevronDown, MapPin, Waypoints } from 'lucide-react'
import type { MunicipalityRegion } from '@/integrations/payload/queries'
import { joinNames } from '@/hooks/useMunicipalityRegion'
import { cn } from '@/lib/utils'

/**
 * Whether the obec shares with a mikroregion — always on show where its admins and organizers work,
 * since the volunteers and co-organizers they're offered come from the whole region. Opens to what
 * exactly is shared and what stays the obec's own.
 */
export function RegionNotice({
  region,
  municipalityId,
  municipalityName,
  className,
}: {
  /** From useMunicipalityRegion — nothing shows while it loads. */
  region: MunicipalityRegion | null | undefined
  municipalityId: string
  municipalityName: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  if (region === undefined) return null

  if (region === null) {
    return (
      <p className={cn('flex items-start gap-2 text-sm text-muted-foreground', className)}>
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          Samostatná obec: akce, dobrovolníci i spolupořádání zůstávají v obci {municipalityName}.
        </span>
      </p>
    )
  }

  const others = region.municipalities.filter((m) => m.id !== municipalityId).map((m) => m.name)
  const sharing =
    others.length === 0
      ? 'Zatím v něm není jiná obec, sdílet začnete, jakmile správce Lonvity nějakou přidá.'
      : `Akce, dobrovolníky a spolupořádání sdílíte s ${others.length === 1 ? 'obcí' : 'obcemi'} ${joinNames(others)}.`

  return (
    <div className={cn('rounded-2xl border border-primary/30 bg-brand-purple-pale', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={detailsId}
        className="flex w-full items-start gap-3 rounded-2xl p-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Waypoints className="mt-0.5 h-5 w-5 shrink-0 text-brand-purple-dark" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-brand-purple-dark">Mikroregion {region.name}</span>
          <span className="block text-sm text-foreground/85">{sharing}</span>
        </span>
        <span className="mt-0.5 hidden shrink-0 text-sm font-semibold text-brand-purple-dark sm:inline">
          {open ? 'Skrýt' : 'Co to znamená'}
        </span>
        <ChevronDown
          className={cn(
            'mt-0.5 h-5 w-5 shrink-0 text-brand-purple-dark transition-transform motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div
          id={detailsId}
          className="space-y-3 border-t border-primary/20 px-3.5 pb-3.5 pt-3 text-sm sm:pl-11"
        >
          <ul className="flex flex-wrap gap-1.5" aria-label="Obce mikroregionu">
            {region.municipalities.map((m) => (
              <li
                key={m.id}
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-semibold',
                  m.id === municipalityId
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-foreground',
                )}
              >
                {m.name}
                {m.id === region.main_municipality_id && (
                  <span className="font-normal opacity-80">, hlavní obec</span>
                )}
              </li>
            ))}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="font-semibold">Sdílíte</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-foreground/85">
                <li>akce: obyvatelé všech obcí je vidí ve svém výpisu</li>
                <li>dobrovolníky: na své akce zvete i ty ze sousedních obcí</li>
                <li>spolupořádání: organizace i obce se mohou navzájem přizvat</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold">Zůstává vaše</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-foreground/85">
                <li>statistiky a přehledy obce</li>
                <li>žádosti o roli organizátora</li>
                <li>nastavení a import akcí</li>
              </ul>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Mikroregiony nastavuje správce Lonvity.</p>
        </div>
      )}
    </div>
  )
}
