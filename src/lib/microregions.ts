import type { Payload, PayloadRequest } from 'payload'

import { relationId } from '@/lib/relations'

/**
 * Mikroregion (Microregions): obce that share one view — their events show to each other's
 * residents, their volunteers help in each other's villages, and their organizations and obce
 * co-organize each other's events. Everything else stays with the obec. An obec belongs to one
 * region at most; one without a region is a region of its own.
 */

/** The obce `municipalityId` shares everything regional with — itself included, alone when it has
 * no region. */
export async function regionMunicipalityIds(
  payload: Payload,
  municipalityId: number | string,
  req?: PayloadRequest,
): Promise<string[]> {
  const key = `regionOf:${municipalityId}`
  const cached = req?.context?.[key] as string[] | undefined
  if (cached) return cached
  const region = await payload.find({
    collection: 'microregions',
    where: { municipalities: { in: [municipalityId] } },
    select: { municipalities: true },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  const ids = region.docs[0]
    ? ((region.docs[0].municipalities ?? []) as unknown[])
        .map(relationId)
        .filter((id): id is string => id !== null)
    : []
  const result = ids.includes(String(municipalityId)) ? ids : [String(municipalityId)]
  if (req?.context) req.context[key] = result
  return result
}

/** Whether two obce are the same one or share a region. */
export async function inSameRegion(
  payload: Payload,
  a: number | string | null | undefined,
  b: number | string | null | undefined,
  req?: PayloadRequest,
): Promise<boolean> {
  if (a == null || b == null) return false
  if (String(a) === String(b)) return true
  return (await regionMunicipalityIds(payload, a, req)).includes(String(b))
}
