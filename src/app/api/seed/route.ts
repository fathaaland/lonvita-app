import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'

import { logger, serializeError } from '@/lib/logger'
import { correlationIdFromHeaders } from '@/lib/logger/correlation'
import { runSeed } from '@/lib/seed/run'

// Requires Vercel Pro for 60s; on Hobby (default 10s) the seed might time out
// if the DB is cold. Run it once after deploy, not on every request.
export const maxDuration = 60

export async function POST(request: Request) {
  const correlationId = correlationIdFromHeaders(request.headers)

  const secret = process.env.SEED_SECRET
  if (!secret) {
    logger.error('seed.misconfigured', { event: 'seed.misconfigured', reason: 'SEED_SECRET not set', correlationId })
    return NextResponse.json({ error: 'SEED_SECRET not configured' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${secret}`) {
    // An unauthorised hit on the endpoint that can rewrite the whole database is worth seeing.
    logger.warn('seed.unauthorized', { event: 'seed.unauthorized', correlationId })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const payload = await getPayload({ config })
    logger.info('seed.started', { event: 'seed.started', correlationId })
    await runSeed(payload)
    logger.info('seed.finished', { event: 'seed.finished', correlationId })
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('seed.failed', { event: 'seed.failed', ...serializeError(error), correlationId })
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
