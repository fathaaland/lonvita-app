'use client'

import { useEffect, useState } from 'react'
import { getMunicipality } from '@/integrations/payload/queries'

export type MunicipalityFeatures = { sms: boolean; importAi: boolean }

/** Asked once per obec per page load — every cancel button in a table shares the one answer. */
const cache = new Map<string, Promise<MunicipalityFeatures>>()

const NONE: MunicipalityFeatures = { sms: false, importAi: false }

/**
 * What the obec pays for (lib/services) — the app leaves out what it doesn't have: no "they'll get
 * an SMS" without SMS, no pasting a program without the AI import. Until it's known, and for no
 * obec, nothing is promised.
 */
export function useMunicipalityFeatures(
  municipalityId: string | null | undefined,
): MunicipalityFeatures {
  const [features, setFeatures] = useState<MunicipalityFeatures>(NONE)

  useEffect(() => {
    if (!municipalityId) return
    let active = true
    let request = cache.get(municipalityId)
    if (!request) {
      request = getMunicipality(municipalityId).then((m) =>
        m ? { sms: m.sms_enabled, importAi: m.import_ai_enabled } : NONE,
      )
      cache.set(municipalityId, request)
      request.catch(() => cache.delete(municipalityId))
    }
    request.then((f) => active && setFeatures(f)).catch(() => {})
    return () => {
      active = false
    }
  }, [municipalityId])

  return municipalityId ? features : NONE
}

/** "e-mailem, SMS a v aplikaci" or "e-mailem a v aplikaci" — how the registrants hear of a cancel. */
export const cancelChannels = (sms: boolean) =>
  sms ? 'e-mailem, SMS a v aplikaci' : 'e-mailem a v aplikaci'
