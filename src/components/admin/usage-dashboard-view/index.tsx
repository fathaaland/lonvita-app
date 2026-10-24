import { notFound } from 'next/navigation'

import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'

import type { AdminViewServerProps } from 'payload'

import { UsageDashboardClient } from './usage-dashboard-client'

/**
 * Custom admin view is not gated by collection access rules (those only apply to
 * `payload.find`/REST) — the role check must happen here, otherwise a non-admin hitting
 * `/admin/usage-dashboard` directly would render the page even if it's not in their nav.
 */
export const UsageDashboardView = async (props: AdminViewServerProps) => {
  const { initPageResult, params, searchParams } = props
  const { req, permissions, visibleEntities } = initPageResult

  if (req.user?.role !== 'admin') {
    notFound()
  }

  return (
    <DefaultTemplate
      i18n={req.i18n}
      params={params}
      payload={req.payload}
      permissions={permissions}
      req={req}
      searchParams={searchParams}
      user={req.user}
      viewType="usage-dashboard"
      visibleEntities={visibleEntities}
    >
      <Gutter>
        <h1 style={{ marginBottom: '1.5rem' }}>Usage &amp; Cost Dashboard</h1>
        <UsageDashboardClient />
      </Gutter>
    </DefaultTemplate>
  )
}
