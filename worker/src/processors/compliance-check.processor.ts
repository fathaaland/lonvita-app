import { getPlatformDeciders, sendNotificationToMany, escapeHtml } from '@/collections/shared/notify'
import { recordAuditLog } from '@/collections/shared/auditLog'
import {
  describeChange,
  esbirkaPortalUrl,
  EsbirkaError,
  fetchRelations,
  fetchVersions,
  fingerprintOf,
  isComparableFingerprint,
  staleUrlOf,
} from '@/lib/compliance/esbirka'
import { logger, serializeError } from '@/lib/logger'

import { getWorkerPayload } from '../runtime/payload'

import type { ComplianceCheckJobResult } from '@/lib/queue/contracts'
import type { Payload } from 'payload'

/** One request at a time, a moment apart — e-Sbírka is a public service. */
const PACE_MS = 2_000
const COMPLIANCE_LINK = '/superadmin/compliance'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const tellPlatform = async (payload: Payload, title: string, message: string) => {
  const { userIds } = await getPlatformDeciders(payload)
  await sendNotificationToMany(payload, userIds, {
    title,
    message,
    link: COMPLIANCE_LINK,
    email: { subject: `Lonvita: ${title}`, body: `<p>${escapeHtml(message)}</p>` },
  })
}

/**
 * Every night: each regulation of the register (LegalRequirements) watched in e-Sbírka is read; a
 * new or upcoming version flags it "Změna předpisu" and the platform's admins hear what changed. A
 * periodic review that came due flags it "Ke kontrole". The first read of a regulation only learns
 * its versions. One regulation failing never stops the rest — e-Sbírka being down shows on the
 * regulation and is tried again the next night.
 */
export const processComplianceCheckJob = async ({
  now = new Date(),
  fetchImpl = fetch,
  paceMs = PACE_MS,
}: { now?: Date; fetchImpl?: typeof fetch; paceMs?: number } = {}): Promise<ComplianceCheckJobResult> => {
  const payload = await getWorkerPayload()
  const result: ComplianceCheckJobResult = { checked: 0, changed: [], dueForReview: [], failed: [] }
  const summaries = new Map<string, string>()

  const requirements = await payload.find({
    collection: 'legal-requirements',
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  for (const req of requirements.docs) {
    if (req.status === 'ok' && req.nextReviewAt && new Date(req.nextReviewAt) <= now) {
      await payload.update({
        collection: 'legal-requirements',
        id: req.id,
        data: { status: 'review_needed' },
        overrideAccess: true,
      })
      result.dueForReview.push(req.code)
    }

    if (!req.esbirkaWatch || !staleUrlOf(req.code)) continue
    if (result.checked > 0) await sleep(paceMs)
    result.checked++
    try {
      const versions = await fetchVersions(req.code, fetchImpl)
      await sleep(paceMs)
      const relations = await fetchRelations(req.code, fetchImpl)
      const fingerprint = fingerprintOf(versions, relations)
      const previous = req.esbirkaFingerprint ?? ''
      // The first read — or one of a fingerprint from before novely were watched — only learns.
      const changed = isComparableFingerprint(previous) && fingerprint !== previous
      const summary = changed ? describeChange(previous, versions, relations) : null
      await payload.update({
        collection: 'legal-requirements',
        id: req.id,
        data: {
          esbirkaFingerprint: fingerprint,
          esbirkaCheckedAt: now.toISOString(),
          esbirkaError: null,
          ...(changed
            ? { status: 'changed', esbirkaChangedAt: now.toISOString(), esbirkaChangeSummary: summary }
            : {}),
        },
        overrideAccess: true,
      })
      if (changed && summary) {
        result.changed.push(req.code)
        const url = esbirkaPortalUrl(req.code)
        summaries.set(req.code, `${req.code} (${req.title}): ${summary}${url ? ` ${url}` : ''}`)
        await recordAuditLog(payload, {
          action: 'legal-requirements.change-detected',
          targetCollection: 'legal-requirements',
          targetId: req.id,
          metadata: { code: req.code, summary, previous, fingerprint },
        })
      }
    } catch (error) {
      result.failed.push(req.code)
      const message = error instanceof EsbirkaError ? error.message : 'Kontrola v e-Sbírce selhala.'
      logger.warn('e-Sbírka check failed', {
        event: 'compliance.esbirka_failed',
        code: req.code,
        ...serializeError(error),
      })
      await payload
        .update({
          collection: 'legal-requirements',
          id: req.id,
          data: { esbirkaCheckedAt: now.toISOString(), esbirkaError: message },
          overrideAccess: true,
        })
        .catch(() => {})
    }
  }

  try {
    if (summaries.size > 0) {
      await tellPlatform(
        payload,
        'Změna předpisu v registru',
        `V e-Sbírce se změnily předpisy, které Lonvita sleduje. Posuďte dopad a označte je jako zkontrolované. ${[...summaries.values()].join(' · ')}`,
      )
    }
    if (result.dueForReview.length > 0) {
      await tellPlatform(
        payload,
        'Předpisy ke kontrole',
        `Uplynula lhůta pravidelné kontroly: ${result.dueForReview.join(', ')}.`,
      )
    }
  } catch (error) {
    logger.error('Compliance notice not sent', { event: 'compliance.notice_failed', ...serializeError(error) })
  }

  logger.info('Compliance check done', { event: 'compliance.checked', ...result })
  return result
}
