import * as Sentry from '@sentry/nextjs'

import { sentryDsn, sentryEnvironment, sentryTracesSampleRate } from './sentry.shared'

// No `dataCollection` / `sendDefaultPii` and no `includeLocalVariables`: requests and locals here
// carry citizens' personal data, which must not leave for a third party by default.
Sentry.init({
  dsn: sentryDsn,
  environment: sentryEnvironment,
  tracesSampleRate: sentryTracesSampleRate,
})
