import * as Sentry from '@sentry/nextjs'

import { sentryDsn, sentryEnvironment, sentryScrubbing, sentryTracesSampleRate } from './sentry.shared'

Sentry.init({
  dsn: sentryDsn,
  environment: sentryEnvironment,
  tracesSampleRate: sentryTracesSampleRate,
  ...sentryScrubbing,
})
