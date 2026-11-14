'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

import { getMunicipalityServices } from '@/integrations/payload/queries'
import { READ_ONLY_MESSAGE } from '@/lib/billing/status'
import type { MunicipalityServices } from '@/lib/services/municipality-services'
import { cn } from '@/lib/utils'

const date = (iso: string) => new Date(iso).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' })

/** Above every section of the obec's administration while its licence is suspended or read-only
 * (lib/billing/status) — the admin finds out before a save is refused, not from it. */
export function BillingStatusNotice({ municipalityId, className }: { municipalityId: string; className?: string }) {
  const [services, setServices] = useState<MunicipalityServices | null>(null)

  useEffect(() => {
    let current = true
    getMunicipalityServices(municipalityId)
      .then((s) => current && setServices(s))
      .catch(() => current && setServices(null))
    return () => {
      current = false
    }
  }, [municipalityId])

  if (!services || services.billingStatus === 'active') return null
  const next = services.billingNextStepAt ? date(services.billingNextStepAt) : null
  const text =
    services.billingStatus === 'terminated'
      ? `Smlouva obce s Lonvitou skončila, obec je jen pro čtení.${next ? ` ${next} se všechny údaje obce smažou —` : ''} stáhněte si je včas v Nastavení (Všechna data obce).`
      : services.billingStatus === 'read_only'
      ? READ_ONLY_MESSAGE + (next ? ` Pokud licenci neobnovíte do ${next}, smlouva skončí.` : '')
      : 'Licence obce je kvůli nezaplacení pozastavená: SMS a import akcí z webu neběží.' +
        (services.billingNextStepAt
          ? ` Pokud ji neobnovíte do ${date(services.billingNextStepAt)}, obec přejde do režimu jen pro čtení.`
          : '')

  return (
    <div
      role="alert"
      className={cn('flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm', className)}
    >
      <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
      <p>{text}</p>
    </div>
  )
}
