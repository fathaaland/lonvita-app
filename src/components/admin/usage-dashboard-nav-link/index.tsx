import type { ServerProps } from 'payload'

import { UsageDashboardNavLinkClient } from './usage-dashboard-nav-link-client'

export const UsageDashboardNavLink = ({ user }: Pick<ServerProps, 'user'>) => {
  // Match the view's server-side role check without depending on client auth hydration.
  if (user?.role !== 'admin') return null

  return <UsageDashboardNavLinkClient />
}
