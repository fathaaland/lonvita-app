import { test, expect } from '@playwright/test'

// Exercises the demo credentials created by `pnpm db:seed` — see src/seed.ts.
const ADMIN = { email: 'admin@admin.cz', password: 'admin1234' }
const ORGANIZER = { email: 'poradatel@poradatel.cz', password: 'poradatel1234' }

async function loginViaAuthPage(page: import('@playwright/test').Page, user: { email: string; password: string }) {
  await page.goto('/auth', { waitUntil: 'domcontentloaded' })
  await page.fill('#email', user.email)
  await page.fill('#password', user.password)
  await page.click('button[type="submit"]')
}

test.describe('Frontend — auth and role routing', () => {
  test('an unauthenticated visitor is redirected from / to /auth', async ({ page }) => {
    await page.goto('/')
    await page.waitForURL(/\/auth/)
    await expect(page.locator('#email')).toBeVisible()
  })

  test('logging in as the seeded admin lands on /admin-obce', async ({ page }) => {
    await loginViaAuthPage(page, ADMIN)
    await page.waitForURL(/\/admin-obce/, { timeout: 15000 })
    await expect(page).toHaveURL(/\/admin-obce/)
  })

  test('logging in as the seeded organizer lands on the community home feed, not /admin-obce', async ({ page }) => {
    await loginViaAuthPage(page, ORGANIZER)
    await page.waitForURL((url) => url.pathname === '/', { timeout: 15000 })
    await expect(page).toHaveURL(/\/$/)
    // Organizer bottom nav includes "Vytvořit" but never the admin-only "Obec" link.
    await expect(page.getByRole('link', { name: 'Vytvořit' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Obec' })).toHaveCount(0)
  })

  test('a wrong password shows an error and does not navigate away from /auth', async ({ page }) => {
    await loginViaAuthPage(page, { email: ADMIN.email, password: 'not-the-right-password' })
    await expect(page.getByText(/Nesprávný e-mail nebo heslo/)).toBeVisible({ timeout: 10000 })
    await expect(page).toHaveURL(/\/auth/)
  })
})
