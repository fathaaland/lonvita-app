import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { canAccessMunicipality } from '@/lib/exports/access'
import { describeComplaintQueue } from '@/lib/review-complaint-queue'
import { complaintsDecidedByPlatform } from '@/lib/review-complaints'

/**
 * The obec's queue of complaints about reviews, oldest first (describeComplaintQueue) — without the
 * ones the obec is a party to, which the platform admin decides (/api/review-complaints/platform).
 * For the obec's admin or a platform admin.
 *
 * GET /api/municipalities/:id/review-complaints
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canAccessMunicipality(payload, user, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const complaints = await payload.find({
    collection: 'review-complaints',
    where: { and: [{ municipality: { equals: id } }, { status: { equals: 'pending' } }] },
    sort: 'createdAt',
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const byPlatform = await complaintsDecidedByPlatform(payload, complaints.docs)
  const docs = await describeComplaintQueue(
    payload,
    complaints.docs.filter((c) => !byPlatform.has(String(c.id))),
  )
  return NextResponse.json({ docs })
}
