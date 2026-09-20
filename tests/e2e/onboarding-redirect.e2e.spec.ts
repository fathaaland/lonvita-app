import { test, expect, type Page } from '@playwright/test'

// A freshly registered account has no onboarding behind it yet, so signing in must land on
// /onboarding — and must not show anything else on the way there. Records every main-frame
// navigation (History API ones included, which is how the client-side bounce shows up) so a
// detour through "/" is visible in the assertion instead of being a timing coin-flip.

const STAMP = Date.now()
const NEW_USER = { email: `onboarding-flash-${STAMP}@test.local`, password: 'test1234', fullName: 'Nováček Testovací' }

async function register(page: Page) {
  await page.goto('/auth?mode=signup', { waitUntil: 'domcontentloaded' })

  // Opening the obec dialog needs React listening, so this doubles as the hydration gate —
  // text typed before that gets wiped when the controlled inputs mount.
  await page.click('#municipality')
  await page.getByRole('button', { name: /Moje obec tu zatím není/ }).click()

  await page.fill('#fullName', NEW_USER.fullName)
  await page.fill('#email', NEW_USER.email)
  await page.fill('#password', NEW_USER.password)
  await page.getByText('Souhlasím s podmínkami používání Lonvity.').click()
  await page.getByRole('button', { name: 'Vytvořit účet' }).click()
  await expect(page.getByText(/Účet vytvořen/)).toBeVisible({ timeout: 15000 })
}

test.describe('Sign-in for an account that still needs onboarding', () => {
  test('goes straight to /onboarding, without showing the app in between', async ({ page }) => {
    const visited: string[] = []
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname)
    })

    await register(page)

    // Back on the sign-in form the register flow leaves behind.
    await page.fill('#email', NEW_USER.email)
    await page.fill('#password', NEW_USER.password)
    visited.length = 0
    await page.getByRole('button', { name: 'Přihlásit se' }).click()

    await page.waitForURL(/\/onboarding/, { timeout: 20000 })
    await expect(page.getByRole('heading', { name: 'Kdy jste se narodil/a?' })).toBeVisible({ timeout: 15000 })

    expect(visited.filter((p) => p === '/')).toEqual([])
  })
})
