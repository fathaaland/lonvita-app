import { test, expect } from '@playwright/test'

// Exercises the demo credentials created by `pnpm db:seed` — see src/seed.ts.
const ADMIN = { email: 'admin@admin.cz', password: 'admin1234' }

/** Typing into these inputs only sticks once React has hydrated and taken them over — filling
 * straight after domcontentloaded silently loses whatever was typed first. Retry until the
 * value stays put. */
async function fillWhenReady(page: import('@playwright/test').Page, selector: string, value: string) {
  await expect(async () => {
    await page.fill(selector, value)
    expect(await page.inputValue(selector)).toBe(value)
  }).toPass({ timeout: 15000 })
}

async function loginViaAuthPage(page: import('@playwright/test').Page, user: { email: string; password: string }) {
  await page.goto('/auth', { waitUntil: 'domcontentloaded' })
  await fillWhenReady(page, '#email', user.email)
  await fillWhenReady(page, '#password', user.password)
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

  test('a wrong password shows an error and does not navigate away from /auth', async ({ page }) => {
    await loginViaAuthPage(page, { email: ADMIN.email, password: 'not-the-right-password' })
    await expect(page.getByText(/Nesprávný e-mail nebo heslo/)).toBeVisible({ timeout: 10000 })
    await expect(page).toHaveURL(/\/auth/)
  })
})
