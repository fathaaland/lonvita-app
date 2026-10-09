import { createHash, timingSafeEqual } from 'node:crypto'

import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'

import { logger, serializeError } from '@/lib/logger'
import { correlationIdFromHeaders } from '@/lib/logger/correlation'
import { runSeed } from '@/lib/seed/run'

/** Compared as digests: equal length whatever was sent, and timingSafeEqual doesn't give away how
 * much of the secret a guess got right the way `===` does. Guessing is also metered in the proxy. */
const matchesSecret = (header: string | null, secret: string): boolean => {
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${secret}`))
}

// Requires Vercel Pro for 60s; on Hobby (default 10s) the seed might time out
// if the DB is cold. Run it once after deploy, not on every request.
export const maxDuration = 60

export async function POST(request: Request) {
  const correlationId = correlationIdFromHeaders(request.headers)

  const secret = process.env.SEED_SECRET
  if (!secret) {
    logger.error('Seed endpoint misconfigured', { event: 'seed.misconfigured', reason: 'SEED_SECRET not set', correlationId })
    return NextResponse.json({ error: 'SEED_SECRET not configured' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (!matchesSecret(authHeader, secret)) {
    // An unauthorised hit on the endpoint that can rewrite the whole database is worth seeing.
    logger.warn('Seed request rejected', { event: 'seed.unauthorized', correlationId })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const payload = await getPayload({ config })
    logger.info('Seed started', { event: 'seed.started', correlationId })
    await runSeed(payload)
    logger.info('Seed finished', { event: 'seed.finished', correlationId })
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Seed failed', { event: 'seed.failed', ...serializeError(error), correlationId })
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
