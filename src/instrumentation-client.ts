import * as Sentry from '@sentry/nextjs'

import { sentryDsn, sentryEnvironment, sentryTracesSampleRate } from '../sentry.shared'

Sentry.init({
  dsn: sentryDsn,
  environment: sentryEnvironment,
  tracesSampleRate: sentryTracesSampleRate,
})

/** Traces App Router navigations. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
