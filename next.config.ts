import { withPayload } from '@payloadcms/next/withPayload'
import { withSentryConfig } from '@sentry/nextjs/config'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

/**
 * Starts as Report-Only: Next.js and the Payload admin both inject inline scripts and styles, so
 * an enforced policy has to be tightened (nonces) against real violation reports first. Map tiles
 * come from NEXT_PUBLIC_MAP_TILE_URL's host when set, else OpenStreetMap; Turnstile from
 * challenges.cloudflare.com.
 */
const tileOrigin = (() => {
  try {
    return new URL((process.env.NEXT_PUBLIC_MAP_TILE_URL ?? '').replace(/\{[a-z]\}/g, 'a')).origin
  } catch {
    return 'https://*.tile.openstreetmap.org https://tile.openstreetmap.org'
  }
})()
/** Violation reports go to Sentry's security endpoint (derived from the public DSN) — without a
 * report-uri the Report-Only policy reports to nobody, and there'd be nothing to tighten it against.
 * Unset DSN = no reporting. */
const cspReportUri = (() => {
  const match = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() ?? '')
  if (!match) return null
  const [, key, host, project] = match
  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development'
  return `https://${host}/api/${project}/security/?sentry_key=${key}&sentry_environment=${environment}`
})()

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${tileOrigin}`,
  "font-src 'self' data:",
  "connect-src 'self' https://challenges.cloudflare.com",
  'frame-src https://challenges.cloudflare.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "object-src 'none'",
  ...(cspReportUri ? [`report-uri ${cspReportUri}`] : []),
].join('; ')

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
]

const nextConfig: NextConfig = {
  // The proxy (src/proxy.ts) skips /admin and static paths, so the headers every response needs
  // — the Payload admin's included — are set here instead.
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  // No "X-Powered-By: Next.js" — it tells an attacker which framework's advisories to try first.
  poweredByHeader: false,
  experimental: {
    // The proxy (src/proxy.ts) buffers request bodies and truncates anything over its 10 MB
    // default, which broke photo uploads mid-stream ("Unexpected end of form"). Photos are also
    // downscaled client-side (src/lib/image.ts); this is headroom for anything that isn't.
    proxyClientMaxBodySize: '25mb',
  },
  // The event share images read these from disk at runtime (src/lib/share/eventShareImage.tsx) —
  // no import for the tracer to follow, so the deployment has to be told to keep them.
  outputFileTracingIncludes: {
    '/api/events/[id]/share-image': ['./src/lib/exports/fonts/NotoSans-*.ttf', './src/assets/lonvita-symbol.png'],
  },
  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  turbopack: {
    root: path.resolve(dirname),
  },
}

export default withSentryConfig(withPayload(nextConfig, { devBundleServerPackages: false }), {
  org: 'dobrovolny',
  project: 'lonvita-app',
  sentryUrl: 'https://de.sentry.io',
  // Source maps are uploaded only when the build has a token (Vercel); local builds skip it.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  // Browser events go through our own origin so ad blockers don't drop them.
  tunnelRoute: '/monitoring',
  silent: !process.env.CI,
})
