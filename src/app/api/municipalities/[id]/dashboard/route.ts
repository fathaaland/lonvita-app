import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { computeMunicipalityDashboard } from '@/lib/dashboard'
import { canAccessMunicipality } from '@/lib/exports/access'
import { loadFeedback, loadMunicipalityExportData } from '@/lib/exports/load'

/**
 * The obec's dashboard (admin-obce): its overview for every period, the community report and the
 * events table, worked out here from the same rows the exports read (lib/exports/load) — the page
 * gets numbers, not the obec's whole history of registrations. For the obec's admin or a platform
 * admin. `scope=mine` narrows it to the viewer's own events ("Jen moje akce").
 *
 * GET /api/municipalities/:id/dashboard?scope=all|mine
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!/^\d+$/.test(id) || !(await canAccessMunicipality(payload, user, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = new URL(request.url).searchParams.get('scope') === 'mine' ? 'mine' : 'all'
  const data = await loadMunicipalityExportData(payload, id, scope === 'mine' ? String(user.id) : undefined).catch(
    (error: { status?: number }) => {
      if (error?.status === 404) return null
      throw error
    },
  )
  if (!data) return NextResponse.json({ error: 'Obec neexistuje.' }, { status: 404 })
  const feedback = await loadFeedback(
    payload,
    data.registrations.map((r) => r.id),
  )

  const dashboard = computeMunicipalityDashboard({
    events: data.events,
    registrations: data.registrations,
    profiles: data.profiles,
    categories: data.categories,
    feedback,
  })
  return NextResponse.json({ municipalityName: data.municipalityName, ...dashboard }, { headers: { 'Cache-Control': 'private, no-store' } })
}
