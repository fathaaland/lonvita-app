import { NextResponse } from 'next/server'
import { APIError, type Payload } from 'payload'

import { canAccessMunicipality } from '@/lib/exports/access'
import { logger, serializeError } from '@/lib/logger'
import { consumeRateLimit } from '@/lib/security/rate-limit'

/** Shared by the /api/import routes. */

/** AI reads (pasted text, files, running a source by hand) per admin — each one costs money. */
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

export async function mayImportFor(
  payload: Payload,
  user: { id: number; role?: string | null },
  municipalityId: string,
): Promise<boolean> {
  return Boolean(Number(municipalityId)) && canAccessMunicipality(payload, user, municipalityId)
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
