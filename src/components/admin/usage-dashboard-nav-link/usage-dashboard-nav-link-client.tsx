'use client'

import { usePathname } from 'next/navigation'

import { Link, NavGroup, useConfig } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'

const baseClass = 'nav'

export const UsageDashboardNavLinkClient = () => {
  const {
    config: {
      routes: { admin: adminRoute },
    },
  } = useConfig()
  const pathname = usePathname()

  const href = formatAdminURL({ adminRoute, path: '/usage-dashboard' })
  const isActive = pathname === href

  return (
    <NavGroup label="Analytics">
      {isActive ? (
        <div className={`${baseClass}__link`}>
          <span className={`${baseClass}__link-label`}>Usage Dashboard</span>
        </div>
      ) : (
        <Link className={`${baseClass}__link`} href={href} prefetch={false}>
          <span className={`${baseClass}__link-label`}>Usage Dashboard</span>
        </Link>
      )}
    </NavGroup>
  )
}
