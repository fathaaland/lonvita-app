import { NextResponse } from 'next/server'
import { APIError, type Payload } from 'payload'

import { logger, serializeError } from '@/lib/logger'
import { servicesHeld } from '@/lib/billing/status'
import { consumeRateLimit } from '@/lib/security/rate-limit'

/** Shared by the /api/import routes. */

/** AI reads (pasted text, files, running a source by hand) per admin or organizer — each one costs
 * the obec's package. */
const AI_IMPORT_LIMIT = { max: 20, windowSeconds: 60 * 60 }

export async function aiImportRateLimited(userId: number | string): Promise<NextResponse | null> {
  const limit = await consumeRateLimit({
    namespace: 'import-ai',
    identifier: String(userId),
    ...AI_IMPORT_LIMIT,
  })
  if (limit.allowed) return null
  return NextResponse.json(
    { error: 'Importů bylo za poslední hodinu moc — zkuste to prosím později.' },
    { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
  )
}

/** Pasted text and files are read by the AI alone — refused for an obec that doesn't pay for it. */
export async function aiImportNotSubscribed(payload: Payload, municipalityId: string): Promise<NextResponse | null> {
  const municipality = await payload.findByID({
    collection: 'municipalities',
    id: municipalityId,
    depth: 0,
    overrideAccess: true,
    select: { importAiEnabled: true, billingStatus: true },
  })
  if (servicesHeld(municipality.billingStatus)) {
    return NextResponse.json({ error: 'Služby obce jsou pozastavené.' }, { status: 403 })
  }
  if (municipality.importAiEnabled) return null
  return NextResponse.json({ error: 'Obec nemá objednaný import akcí pomocí AI.' }, { status: 403 })
}

/** A refusal from lib/import/approve or the Events hooks as the response it means; anything else 500. */
export function decisionErrorResponse(
  error: unknown,
  logEvent: string,
  context: Record<string, unknown>,
): NextResponse {
  if (error instanceof APIError && error.status < 500) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  // Payload's own validation (a required field) — its message is already readable.
  if (error instanceof Error && error.name === 'ValidationError') {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  logger.error('Import decision failed', { event: logEvent, ...context, ...serializeError(error) })
  return NextResponse.json({ error: 'Akci se nepodařilo převzít.' }, { status: 500 })
}
