import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ServerProps } from 'payload'
import type { ComponentProps, ReactNode } from 'react'

import { UsageDashboardNavLink } from '@/components/admin/usage-dashboard-nav-link'

const state = vi.hoisted(() => ({ pathname: '/admin/usage-dashboard' }))
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }))
vi.mock('@payloadcms/ui', () => ({
  useAuth: () => ({ user: undefined }),
  useConfig: () => ({ config: { routes: { admin: '/admin' } } }),
  NavGroup: ({ children, label }: { children: ReactNode; label: string }) => (
    <nav aria-label={label}>{children}</nav>
  ),
  Link: ({ prefetch: _prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => (
    <a {...props} />
  ),
}))

const admin = { id: 1, role: 'admin', collection: 'users' } as ServerProps['user']
afterEach(cleanup)

describe('Usage dashboard navigation', () => {
  it('keeps the authorized link across routes even without hydrated client auth', () => {
    state.pathname = '/admin/usage-dashboard'
    const { rerender } = render(<UsageDashboardNavLink user={admin} />)
    expect(screen.getByText('Usage Dashboard')).toBeTruthy()
    for (const pathname of [
      '/admin/collections/users',
      '/admin',
      '/admin/collections/usage-events',
    ]) {
      state.pathname = pathname
      rerender(<UsageDashboardNavLink user={admin} />)
      expect(screen.getByRole('link', { name: 'Usage Dashboard' }).getAttribute('href')).toBe(
        '/admin/usage-dashboard',
      )
    }
  })
  it('hides the group from an obec admin without the global admin role', () => {
    render(
      <UsageDashboardNavLink
        user={
          { ...admin, role: 'user' } as ServerProps['user']
        }
      />,
    )
    expect(screen.queryByRole('navigation', { name: 'Analytics' })).toBeNull()
  })
  it('hides the group without an authenticated server user', () => {
    render(<UsageDashboardNavLink />)
    expect(screen.queryByText('Usage Dashboard')).toBeNull()
  })
})
