import { postgresAdapter } from '@payloadcms/db-postgres'
import { resendAdapter } from '@payloadcms/email-resend'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import { sql } from 'drizzle-orm'
import { uniqueIndex } from 'drizzle-orm/pg-core'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Municipalities } from './collections/Municipalities'
import { EventCategories } from './collections/EventCategories'
import { Profiles } from './collections/Profiles'
import { UserRoles } from './collections/UserRoles'
import { Events } from './collections/Events'
import { Registrations } from './collections/Registrations'
import { EventMedia } from './collections/EventMedia'
import { EventFeedback } from './collections/EventFeedback'
import { AuthIdentities } from './collections/AuthIdentities'
import { MunicipalityAreas } from './collections/MunicipalityAreas'
import { Consents } from './collections/Consents'
import { AuditLog } from './collections/AuditLog'
import { Notifications } from './collections/Notifications'
import { s3ClientConfig } from './lib/s3/client'
import { runSeed } from './lib/seed/run'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  onInit: async (payload) => {
    await runSeed(payload)
  },
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      beforeLogin: ['@/components/admin/auth0-login-button#Auth0LoginButton'],
    },
  },
  collections: [
    Users,
    Media,
    Municipalities,
    EventCategories,
    Profiles,
    UserRoles,
    Events,
    Registrations,
    EventMedia,
    EventFeedback,
    AuthIdentities,
    MunicipalityAreas,
    Consents,
    AuditLog,
    Notifications,
  ],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  // Frontend and backend are the same Next.js app now, so this is a safety net for
  // anyone hitting the API from a different origin, not the primary defense.
  cors: [process.env.NEXT_PUBLIC_APP_URL].filter(Boolean) as string[],
  csrf: [process.env.NEXT_PUBLIC_APP_URL].filter(Boolean) as string[],
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URI || '',
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
    multiTenantPlugin({
      // Domain collections (profiles, events, registrations, ...) each carry their own
      // explicit `municipality` relationship field instead of being registered here —
      // that's the field the ERD and the frontend actually query against (matches the
      // existing Index.tsx pattern of `.eq('municipality_id', muniId)`). Wiring them into
      // the plugin's own tenant-scoping mechanism is deferred until roles/admin scoping
      // (a later subproject) needs it for the Payload admin UI specifically.
      collections: {},
      tenantsSlug: 'municipalities',
      tenantsArrayField: {
        includeDefaultField: true,
      },
      // No domain collections are tenant-scoped yet (collections: {} above), so there's
      // no cross-tenant isolation to weaken here. Without this, the plugin's default
      // tenant-access wrapper overrides Municipalities' own `access` block entirely —
      // e.g. a logged-out request would see MORE than a logged-in one. Municipalities.ts
      // now has its own role==='admin' check for mutations, so this is doing the job
      // that useTenantsCollectionAccess would otherwise do. Revisit once domain
      // collections start getting added to `collections` above.
      useTenantsCollectionAccess: false,
      userHasAccessToAllTenants: (user) => user?.role === 'admin',
    }),
  ],
})
