import { logger } from '@/lib/logger'
import { correlationIdFromHeaders } from '@/lib/logger/correlation'

import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionAfterOperationHook,
  CollectionConfig,
  PayloadRequest,
} from 'payload'

/**
 * Login and logout carry richer detail from the dedicated auth hooks on Users, and `me`/`refresh`
 * fire on nearly every page load — logging them here would only duplicate and drown.
 */
const SKIPPED_OPERATIONS = new Set(['login', 'logout', 'me', 'refresh'])

/** Operations that matter even though they change no document of their own. */
const NOTEWORTHY_READ_OPERATIONS = new Set([
  'forgotPassword',
  'resetPassword',
  'verifyEmail',
  'unlock',
])

/** Bookkeeping Payload writes on its own; a diff mentioning them says nothing. */
const IGNORED_FIELDS = new Set(['updatedAt', 'createdAt'])

type Actor = { userId?: number | string; userEmail?: string; userRole?: string }

const describeActor = (req: PayloadRequest): Actor => {
  const user = req.user as { id?: number | string; email?: string; role?: string } | undefined
  if (!user) return {}
  return { userId: user.id, userEmail: user.email, userRole: user.role }
}

const baseContext = (req: PayloadRequest, slug: string) => ({
  collection: slug,
  correlationId: correlationIdFromHeaders(req?.headers),
  ...describeActor(req),
})

/**
 * Field *names* only, never values. Which fields moved is what an audit trail needs, and it is
 * the part that can be shipped to a third-party log store without spilling anybody's data.
 */
const changedFieldNames = (doc: unknown, previousDoc: unknown): string[] => {
  if (!doc || !previousDoc || typeof doc !== 'object' || typeof previousDoc !== 'object') return []

  const current = doc as Record<string, unknown>
  const previous = previousDoc as Record<string, unknown>

  return Object.keys(current).filter((key) => {
    if (IGNORED_FIELDS.has(key)) return false
    try {
      return JSON.stringify(current[key]) !== JSON.stringify(previous[key])
    } catch {
      // Circular or otherwise unserialisable — assume it changed rather than hide it.
      return true
    }
  })
}

const logCreateOrUpdate: CollectionAfterChangeHook = ({
  doc,
  previousDoc,
  req,
  operation,
  collection,
}) => {
  const slug = collection.slug
  const id = (doc as { id?: number | string })?.id

  logger.info(`${slug}: ${operation}`, {
    event: `crud.${slug}.${operation}`,
    operation,
    id,
    ...(operation === 'update' ? { changedFields: changedFieldNames(doc, previousDoc) } : {}),
    ...baseContext(req, slug),
  })

  return doc
}

const logDelete: CollectionAfterDeleteHook = ({ doc, id, req, collection }) => {
  const slug = collection.slug

  logger.info(`${slug}: delete`, {
    event: `crud.${slug}.delete`,
    operation: 'delete',
    id,
    // Deletions are the one case where the document is gone afterwards, so keep enough of it
    // to recognise what disappeared without copying the whole record into the log store.
    deletedTitle:
      (doc as { title?: string; name?: string })?.title ?? (doc as { name?: string })?.name,
    ...baseContext(req, slug),
  })

  return doc
}

/**
 * Reads are the bulk of all traffic, so they sit at debug and never leave the machine in
 * production (see LOG_LEVEL in the logger). They are still worth emitting: when something does
 * go wrong, the console trail in `vercel logs` shows what the request touched.
 */
const logOperation: CollectionAfterOperationHook = ({ operation, req, collection, result }) => {
  if (SKIPPED_OPERATIONS.has(operation)) return result

  const slug = collection.slug
  const context = { event: `payload.${slug}.${operation}`, operation, ...baseContext(req, slug) }

  if (NOTEWORTHY_READ_OPERATIONS.has(operation)) {
    logger.info(`${slug}: ${operation}`, context)
  } else if (
    !operation.startsWith('create') &&
    !operation.startsWith('update') &&
    !operation.startsWith('delete')
  ) {
    logger.debug(`${slug}: ${operation}`, {
      ...context,
      resultCount: (result as { totalDocs?: number })?.totalDocs,
    })
  }

  return result
}

/**
 * Attaches the CRUD trail to a collection without disturbing the hooks it already declares —
 * applied centrally in payload.config so a newly added collection is covered by construction
 * rather than by somebody remembering to opt in.
 */
export const withCrudLogging = (collection: CollectionConfig): CollectionConfig => ({
  ...collection,
  hooks: {
    ...collection.hooks,
    afterChange: [...(collection.hooks?.afterChange ?? []), logCreateOrUpdate],
    afterDelete: [...(collection.hooks?.afterDelete ?? []), logDelete],
    afterOperation: [...(collection.hooks?.afterOperation ?? []), logOperation],
  },
})
