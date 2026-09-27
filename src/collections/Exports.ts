import type { CollectionAfterDeleteHook, CollectionConfig } from 'payload'

import { EXPORT_FORMATS, EXPORT_KINDS, EXPORT_STATUSES } from '@/lib/exports/contracts'
import { deleteExportFiles } from '@/lib/exports/storage'
import { logger, serializeError } from '@/lib/logger'

/** Set by the nightly cleanup, which already removed the files in one batch request. */
export const EXPORT_FILES_DELETED = 'exportFilesDeleted'

/** A row can also go with its owner's account — take the file along, or it'd sit in S3 unreachable.
 * Best effort: the row is gone either way and nothing links to the file any more. */
const deleteExportFile: CollectionAfterDeleteHook = async ({ doc, req }) => {
  if (!doc.fileKey || req.context[EXPORT_FILES_DELETED]) return
  await deleteExportFiles([doc.fileKey]).catch((error) =>
    logger.warn('Export file delete failed', { event: 'export.file_delete_failed', exportId: doc.id, ...serializeError(error) }),
  )
}

/**
 * One requested file (report / CSV) and where it's at. Created by POST /api/exports, rendered by
 * the worker's `generate-export` job, handed out by GET /api/exports/:id/download — which checks the
 * owner and redirects to a short-lived presigned S3 URL, so the link in the "report je připraven"
 * notification keeps working for the whole retention period instead of expiring with one URL.
 * Every write goes through those server paths (overrideAccess); REST is read-only for the owner.
 */
export const Exports: CollectionConfig = {
  slug: 'exports',
  labels: {
    singular: 'Export',
    plural: 'Exports',
  },
  admin: {
    useAsTitle: 'fileName',
    defaultColumns: ['owner', 'kind', 'format', 'status', 'createdAt'],
    description: 'Generated reports/CSV exports. Written by /api/exports and the worker, not user-edited.',
  },
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      if (user.role === 'admin') return true
      return { owner: { equals: user.id } }
    },
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
    },
    {
      name: 'kind',
      type: 'select',
      required: true,
      options: EXPORT_KINDS.map((value) => ({ label: value, value })),
    },
    {
      name: 'format',
      type: 'select',
      required: true,
      options: EXPORT_FORMATS.map((value) => ({ label: value, value })),
    },
    {
      // Validated by exportRequestSchema before it gets here — municipalityId / organizationId,
      // scope, period.
      name: 'params',
      type: 'json',
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'queued',
      index: true,
      options: EXPORT_STATUSES.map((value) => ({ label: value, value })),
    },
    {
      name: 'fileKey',
      type: 'text',
      admin: { description: 'S3 object key of the rendered file — set once the worker is done.' },
    },
    {
      name: 'fileName',
      type: 'text',
    },
    {
      name: 'error',
      type: 'text',
      admin: { description: 'Why the last attempt failed — only once the job has run out of retries.' },
    },
    {
      // Set on the first download. The delayed `export-ready` job reads it: whoever downloaded the
      // file straight from the dialog doesn't need a notification about it.
      name: 'downloadedAt',
      type: 'date',
    },
    {
      name: 'expiresAt',
      type: 'date',
      required: true,
      index: true,
    },
  ],
  hooks: {
    afterDelete: [deleteExportFile],
  },
  timestamps: true,
}
