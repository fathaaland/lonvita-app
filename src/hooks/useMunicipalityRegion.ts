'use client'

import { useEffect, useState } from 'react'
import { getMunicipalityRegion, type MunicipalityRegion } from '@/integrations/payload/queries'

/** The obec's mikroregion — undefined while loading, null when the obec stands alone. A failed
 * lookup counts as standing alone: the obec's own data is what it surely shares. */
export function useMunicipalityRegion(
  municipalityId: string | null | undefined,
): MunicipalityRegion | null | undefined {
  const [region, setRegion] = useState<MunicipalityRegion | null | undefined>(undefined)

  useEffect(() => {
    if (!municipalityId) return
    let active = true
    setRegion(undefined)
    getMunicipalityRegion(municipalityId)
      .then((r) => active && setRegion(r))
      .catch(() => active && setRegion(null))
    return () => {
      active = false
    }
  }, [municipalityId])

  return municipalityId ? region : undefined
}

/** "Nové Veselí" / "Nové Veselí a Kout" / "Nové Veselí, Kout a Hamry" — names as read in a sentence. */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} a ${names[names.length - 1]}`
}
