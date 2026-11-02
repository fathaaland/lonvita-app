'use client'

import { useEffect, useState } from 'react'
import { getMunicipality } from '@/integrations/payload/queries'
import { SMS_MAX_CAPACITY, smsSentForCapacity } from '@/lib/capacity'

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

/**
 * "e-mailem, SMS a v aplikaci" or "e-mailem a v aplikaci" — how the registrants hear of a cancel.
 * SMS go out only for an event of at most SMS_MAX_CAPACITY places; where the obec has SMS but the
 * event is bigger, it says so, so nobody expects a text that won't come.
 */
export const cancelChannels = (sms: boolean, capacity: number) => {
  if (!sms) return 'e-mailem a v aplikaci'
  if (smsSentForCapacity(capacity)) return 'e-mailem, SMS a v aplikaci'
  return `pouze e-mailem a v aplikaci (SMS se posílají jen u akcí s kapacitou do ${SMS_MAX_CAPACITY} míst)`
}

/** The obec has SMS, but this event is too big (or unlimited) for them — worth telling up front. */
export const smsWithheldForCapacity = (sms: boolean, capacity: number | null | undefined) =>
  sms && typeof capacity === 'number' && !smsSentForCapacity(capacity)
