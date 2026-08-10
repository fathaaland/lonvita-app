import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'

import { runSeed } from '@/lib/seed/run'

// Requires Vercel Pro for 60s; on Hobby (default 10s) the seed might time out
// if the DB is cold. Run it once after deploy, not on every request.
export const maxDuration = 60

export async function POST(request: Request) {
  const secret = process.env.SEED_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'SEED_SECRET not configured' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const payload = await getPayload({ config })
    await runSeed(payload)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[seed]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
