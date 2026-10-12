import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { describeComplaintQueue } from '@/lib/review-complaint-queue'
import { complaintsDecidedByPlatform } from '@/lib/review-complaints'

/**
 * Complaints about reviews the obec is a party to (complaintsDecidedByPlatform), across every obec,
 * oldest first — the platform admin decides those. Each also says which obec it's from.
 *
 * GET /api/review-complaints/platform
 */
export async function GET(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const complaints = await payload.find({
    collection: 'review-complaints',
    where: { status: { equals: 'pending' } },
    sort: 'createdAt',
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const byPlatform = await complaintsDecidedByPlatform(payload, complaints.docs)
  const docs = await describeComplaintQueue(
    payload,
    complaints.docs.filter((c) => byPlatform.has(String(c.id))),
  )
  return NextResponse.json({ docs })
}
