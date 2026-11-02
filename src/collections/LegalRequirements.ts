import type { CollectionAfterChangeHook, CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { auditDeletion, writeAuditLog } from './shared/auditLog'

const platformAdmin = ({ req: { user } }: { req: { user?: { role?: string | null } | null } }) =>
  user?.role === 'admin'

/** Written by the compliance check alone (worker compliance-check) — the platform reads it. */
const systemField = { create: () => false, update: () => false }

const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000

/**
 * "Zkontrolováno" moves the next review a whole interval on and clears what was waiting (a review
 * due, a change of law spotted in e-Sbírka) — the change that was spotted becomes the known version.
 */
const recordReview: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  if (!data) return data
  const reviewedAt = data.lastReviewedAt ?? originalDoc?.lastReviewedAt
  const interval = data.reviewIntervalMonths ?? originalDoc?.reviewIntervalMonths ?? 12
  const justReviewed = Boolean(data.lastReviewedAt) && data.lastReviewedAt !== originalDoc?.lastReviewedAt
  return {
    ...data,
    nextReviewAt: reviewedAt
      ? new Date(new Date(reviewedAt).getTime() + interval * MONTH_MS).toISOString()
      : null,
    ...(justReviewed
      ? {
          // "Neplní se" stays until someone says it's fixed — a review doesn't make it so.
          status: data.status === 'gap' ? 'gap' : 'ok',
          lastReviewedBy: req.user?.id ?? null,
          esbirkaChangeSummary: null,
          esbirkaChangedAt: null,
        }
      : {}),
  }
}

const AUDITED = [
  'code',
  'title',
  'requirement',
  'implementation',
  'owner',
  'status',
  'reviewIntervalMonths',
  'lastReviewedAt',
  'esbirkaWatch',
] as const

/** Who changed the register and how — the evidence of compliance is itself evidence. */
const auditChange: CollectionAfterChangeHook = ({ doc, previousDoc, operation, req }) => {
  if (!req.user) return doc
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const key of AUDITED) {
    const from = previousDoc?.[key] ?? null
    const to = doc[key] ?? null
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to }
  }
  writeAuditLog(req.payload, {
    action: `legal-requirements.${operation}`,
    actor: Number(req.user.id),
    targetCollection: 'legal-requirements',
    targetId: doc.id,
    metadata: { code: doc.code, changes },
    source: req,
  })
  return doc
}

/**
 * The register of the law Lonvita has to keep (superadmin → Compliance): each regulation, what it
 * asks, how the app meets it, who answers for it and when it was last checked. The worker flags a
 * review that is due, and — for one watched in e-Sbírka — a new or upcoming version of it
 * (lib/compliance/esbirka); a person decides what the change means and marks it reviewed.
 */
export const LegalRequirements: CollectionConfig = {
  slug: 'legal-requirements',
  labels: { singular: 'Legal Requirement', plural: 'Legal Requirements' },
  admin: { useAsTitle: 'code', defaultColumns: ['code', 'title', 'status', 'nextReviewAt'] },
  defaultSort: 'code',
  access: { read: platformAdmin, create: platformAdmin, update: platformAdmin, delete: platformAdmin },
  hooks: {
    beforeChange: [recordReview],
    afterChange: [auditChange],
    afterDelete: [auditDeletion<{ code?: string }>((doc) => ({ metadata: { code: doc.code } }))],
  },
  fields: [
    // "264/2025 Sb." — the Sbírka zákonů form is what the e-Sbírka watch reads; "2016/679 (EU)" for EU law.
    { name: 'code', type: 'text', required: true, unique: true, maxLength: 60 },
    { name: 'title', type: 'text', required: true, maxLength: 300 },
    {
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'zakon',
      options: [
        { label: 'Zákon', value: 'zakon' },
        { label: 'Vyhláška', value: 'vyhlaska' },
        { label: 'Nařízení EU', value: 'eu' },
        { label: 'Jiné (norma, metodika)', value: 'other' },
      ],
    },
    { name: 'url', type: 'text', maxLength: 500 },
    // What it asks of Lonvita (the provisions that apply).
    { name: 'requirement', type: 'textarea' },
    // How the app meets it — where in the app, which setting.
    { name: 'implementation', type: 'textarea' },
    { name: 'owner', type: 'relationship', relationTo: 'users' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'review_needed',
      index: true,
      options: [
        { label: 'V pořádku', value: 'ok' },
        { label: 'Ke kontrole', value: 'review_needed' },
        { label: 'Změna předpisu', value: 'changed' },
        { label: 'Neplní se', value: 'gap' },
      ],
    },
    { name: 'reviewIntervalMonths', type: 'number', min: 1, defaultValue: 12 },
    { name: 'lastReviewedAt', type: 'date' },
    { name: 'lastReviewedBy', type: 'relationship', relationTo: 'users', access: systemField },
    { name: 'nextReviewAt', type: 'date', index: true, access: systemField },
    // Read the regulation's versions from e-Sbírka every night (Sbírka zákonů only).
    { name: 'esbirkaWatch', type: 'checkbox', defaultValue: true },
    // The versions known so far — "/sb/2025/264/2025-11-01|…"; a different set is a change.
    { name: 'esbirkaFingerprint', type: 'text', access: systemField, admin: { hidden: true } },
    { name: 'esbirkaCheckedAt', type: 'date', access: systemField },
    { name: 'esbirkaChangedAt', type: 'date', access: systemField },
    { name: 'esbirkaChangeSummary', type: 'textarea', access: systemField },
    { name: 'esbirkaError', type: 'text', access: systemField },
    { name: 'notes', type: 'textarea' },
  ],
  timestamps: true,
}
