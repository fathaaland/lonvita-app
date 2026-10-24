import { postgresAdapter } from '@payloadcms/db-postgres'
import { resendAdapter } from '@payloadcms/email-resend'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import { sql } from 'drizzle-orm'
import { index, uniqueIndex } from 'drizzle-orm/pg-core'
import path from 'path'
import { buildConfig, type PayloadRequest } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { ImportSettings } from './globals/ImportSettings'
import { Media } from './collections/Media'
import { Municipalities } from './collections/Municipalities'
import { EventCategories } from './collections/EventCategories'
import { Profiles } from './collections/Profiles'
import { UserRoles } from './collections/UserRoles'
import { Events } from './collections/Events'
import { Registrations } from './collections/Registrations'
import { EventFeedback } from './collections/EventFeedback'
import { AuthIdentities } from './collections/AuthIdentities'
import { Consents } from './collections/Consents'
import { AuditLog } from './collections/AuditLog'
import { Notifications } from './collections/Notifications'
import { OrganizerRequests } from './collections/OrganizerRequests'
import { CoOrganizingRequests } from './collections/CoOrganizingRequests'
import { EventDeletionRequests } from './collections/EventDeletionRequests'
import { Organizations } from './collections/Organizations'
import { Exports } from './collections/Exports'
import { VolunteerInvitations } from './collections/VolunteerInvitations'
import { VolunteerRatings } from './collections/VolunteerRatings'
import { ReviewComplaints } from './collections/ReviewComplaints'
import { PoolInvitations } from './collections/PoolInvitations'
import { EventSources } from './collections/EventSources'
import { EventImportCandidates } from './collections/EventImportCandidates'
import { ImportRuns } from './collections/ImportRuns'
import { UsageEvents } from './collections/UsageEvents'
import { SystemLogs } from './collections/SystemLogs'
import { SecurityEvents } from './collections/SecurityEvents'
import { writeAuditLog } from './collections/shared/auditLog'
import { s3ClientConfig } from './lib/s3/client'
import { logger, serializeError, setLogSink } from './lib/logger'
import { createDatabaseLogSink } from './lib/logger/db-sink'
import { correlationIdFromHeaders } from './lib/logger/correlation'
import { withCrudLogging } from './lib/logger/collection-logger'
import { runSeed } from './lib/seed/run'
import { validateEnv } from './lib/env'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

/** Where a refused attempt is itself worth an audit entry: sign-in, accounts, roles and the audit log
 * (vyhláška č. 409/2025 Sb. § 22 odst. 3 písm. a, c, d, h — "including unsuccessful attempts"). */
const REFUSALS_AUDITED = new Set(['users', 'user-roles', 'audit-log', 'municipalities'])

const auditRefusal = ({
  error,
  req,
  collection,
}: {
  error: unknown
  req?: PayloadRequest
  collection?: string
}) => {
  if (!req || !collection || !REFUSALS_AUDITED.has(collection)) return
  const status = (error as { status?: number }).status
  let pathname = ''
  try {
    pathname = new URL(req.url ?? '', 'http://localhost').pathname
  } catch {
    // no URL on a Local API call — nothing to say about where it came from
  }
  const login = pathname.endsWith('/login')
  // A wrong password (401) only on the sign-in itself; elsewhere a 401 is just an expired session.
  if (!(status === 403 || status === 423 || (status === 401 && login))) return
  writeAuditLog(req.payload, {
    action: login ? `${collection}.login` : `${collection}.denied`,
    outcome: 'failure',
    actor: req.user ? Number(req.user.id) : null,
    targetCollection: collection,
    targetId: (req.routeParams?.id as string | undefined) ?? '-',
    metadata: {
      status,
      method: req.method,
      path: pathname,
      message: error instanceof Error ? error.message : null,
    },
    source: req,
  })
}

export default buildConfig({
  onInit: async (payload) => {
    // From here on, warnings, errors, notable events and sign-ins are kept in system-logs and
    // security-events — in every process that builds Payload (the app and the worker alike).
    setLogSink(createDatabaseLogSink(payload))

    // Once per boot, in every process that builds Payload: a deployment missing a variable fails
    // somewhere far from the cause (an e-mail that never leaves, a 500 on the first upload).
    const env = validateEnv()
    if (env.missing.length > 0 && process.env.NODE_ENV !== 'test') {
      logger[env.ok ? 'warn' : 'error']('Environment variables missing', {
        event: 'env.missing',
        required: env.missing.filter((v) => v.required).map((v) => v.key),
        optional: env.missing.filter((v) => !v.required).map((v) => v.key),
      })
    }

    // Every process that builds a Payload instance runs this — the Next app, `payload migrate`,
    // and now the worker (which needs Payload for the cleanup job). Only the app should seed:
    // migrations must not write rows mid-schema-change, and a second seeding process just races
    // the first. Payload sets PAYLOAD_MIGRATING itself during migrations; the worker sets it in
    // its own start script for the same reason.
    if (process.env.PAYLOAD_MIGRATING === 'true') {
      payload.logger.info('PAYLOAD_MIGRATING is set — skipping seed.')
      return
    }
    // Demo data is left to POST /api/seed in production — see RunSeedOptions. The cheap part
    // (categories, the SEED_SUPERADMIN_* bootstrap) still runs on every boot, as intended.
    await runSeed(payload, { includeDemoData: process.env.NODE_ENV !== 'production' })
  },
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      // What the AI calls cost (usage-events) — platform admins only.
      afterNavLinks: ['@/components/admin/usage-dashboard-nav-link#UsageDashboardNavLink'],
      views: {
        usageDashboard: {
          Component: '@/components/admin/usage-dashboard-view#UsageDashboardView',
          path: '/usage-dashboard',
        },
      },
    },
  },
  // Every collection gets the same CRUD trail (create/update/delete at info, reads at debug),
  // applied here rather than collection by collection so a new collection is covered the moment
  // it joins this list instead of when somebody remembers to add the hook.
  collections: [
    Users,
    Media,
    Municipalities,
    EventCategories,
    Profiles,
    UserRoles,
    Events,
    Registrations,
    EventFeedback,
    AuthIdentities,
    Consents,
    AuditLog,
    Notifications,
    OrganizerRequests,
    CoOrganizingRequests,
    EventDeletionRequests,
    Organizations,
    Exports,
    VolunteerInvitations,
    VolunteerRatings,
    ReviewComplaints,
    PoolInvitations,
    EventSources,
    EventImportCandidates,
    ImportRuns,
    UsageEvents,
    SystemLogs,
    SecurityEvents,
  ].map(withCrudLogging),
  globals: [ImportSettings],
  hooks: {
    afterError: [
      ({ error, req, collection }) => {
        const user = req?.user as
          { id?: number | string; email?: string; role?: string } | undefined
        const correlationId = correlationIdFromHeaders(req?.headers)

        // The last net: anything Payload throws and nobody caught — a failed login, a rejected
        // access rule, a database column that does not exist — lands here instead of only in
        // the platform's own request log.
        logger.fatal('Payload unhandled error', {
          event: 'payload.unhandled_error',
          ...serializeError(error),
          collection: collection?.slug ?? null,
          pathname: req?.url,
          method: req?.method,
          userId: user?.id,
          userEmail: user?.email,
          userRole: user?.role,
          correlationId,
        })

        auditRefusal({ error, req, collection: collection?.slug })

        // Handing the id back means a user can quote the number from the screen and it maps
        // straight onto one line in System Logs.
        return { response: { errors: [{ message: error.message }], correlationId } }
      },
    ],
  },
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  // Frontend and backend are the same Next.js app now, so this is a safety net for
  // anyone hitting the API from a different origin, not the primary defense.
  cors: [process.env.NEXT_PUBLIC_APP_URL].filter(Boolean) as string[],
  csrf: [process.env.NEXT_PUBLIC_APP_URL].filter(Boolean) as string[],
  upload: {
    // Matches experimental.proxyClientMaxBodySize in next.config.ts. Photos are downscaled in the
    // browser first (src/lib/image.ts), so this is the cap on a client that skips that step, not
    // a size anybody legitimately reaches.
    limits: { fileSize: 25 * 1024 * 1024 },
  },
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URI || process.env.DATABASE_URI_DATABASE_URL || '',
    },
    afterSchemaInit: [
      ({ schema, extendTable }) => {
        // The Registrations beforeValidate hook's "is this user already registered"
        // check is a find-then-create that isn't atomic — two near-simultaneous
        // requests (a double-click, a slow-network retry) can both pass the check
        // before either row commits, leaving two active registrations for the same
        // event+user and throwing off capacity counts. This index makes the DB itself
        // reject the second insert, closing the race the application-level check can't.
        extendTable({
          table: schema.tables.registrations,
          extraConfig: (table) => ({
            oneActiveRegistrationPerEventUser: uniqueIndex('registrations_active_event_user_idx')
              .on(table.event, table.user)
              .where(sql`${table.status} != 'cancelled'`),
          }),
        })
        // Compound indexes named here rather than through a collection's `indexes`, which names them
        // after the fields alone ("user_readAt_idx") — one namespace for every table in Postgres.
        extendTable({
          table: schema.tables.events,
          extraConfig: (table) => ({
            // The feed and the obec's overview: one obec's events by date.
            municipalityByDate: index('events_municipality_date_time_idx').on(
              table.municipality,
              table.dateTime,
            ),
          }),
        })
        extendTable({
          table: schema.tables.event_import_candidates,
          extraConfig: (table) => ({
            // The same event found again on the next pass over its source — or by two imports running
            // at once — is the one candidate, whatever was decided about it (lib/import/pipeline).
            oneCandidatePerEvent: uniqueIndex('event_import_candidates_municipality_key_idx').on(
              table.municipality,
              table.externalKey,
            ),
          }),
        })
        extendTable({
          table: schema.tables.usage_events,
          extraConfig: (table) => ({
            // The usage dashboard and the import fair-use cap: one obec's (and user's) calls by date.
            municipalityByDate: index('usage_events_municipality_created_at_idx').on(
              table.municipality,
              table.createdAt,
            ),
            municipalityUserByDate: index('usage_events_municipality_user_created_at_idx').on(
              table.municipality,
              table.user,
              table.createdAt,
            ),
          }),
        })
        extendTable({
          table: schema.tables.notifications,
          extraConfig: (table) => ({
            // The unread badge — someone's notifications not read yet.
            unreadOfUser: index('notifications_user_read_at_idx').on(table.user, table.readAt),
          }),
        })
        return schema
      },
    ],
  }),
  email: resendAdapter({
    defaultFromAddress: process.env.RESEND_FROM_EMAIL || 'noreply@lonvita.cz',
    defaultFromName: process.env.RESEND_FROM_NAME || 'Lonvita',
    apiKey: process.env.RESEND_API_KEY || '',
  }),
  sharp,
  plugins: [
    s3Storage({
      collections: { media: { prefix: 'media' } },
      bucket: process.env.S3_BUCKET!,
      config: s3ClientConfig,
    }),
  ],
})
