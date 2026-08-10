import { expect, test } from '@playwright/test'

const configured = process.env.VITE_SYNC_ENABLED === 'true' && Boolean(process.env.VITE_SUPABASE_URL) && Boolean(process.env.VITE_SUPABASE_ANON_KEY)

test.skip(!configured, 'Cloud sync is not configured in the local environment.')

async function loadSampleHousehold(page) {
  await page.goto('/')
  const setup = page.getByRole('heading', { name: "Let's set up your household plan" })
  const dashboard = page.getByRole('heading', { name: /^Good / })
  await setup.or(dashboard).first().waitFor({ state: 'visible' })
  if (await setup.isVisible()) await page.getByRole('button', { name: 'Load sample data' }).click()
  await expect(dashboard).toBeVisible()
}

test('opens two independent browser contexts for sync validation', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()

  try {
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    await Promise.all([loadSampleHousehold(pageA), loadSampleHousehold(pageB)])

    await pageA.getByRole('button', { name: 'Settings' }).first().click()
    await pageB.getByRole('button', { name: 'Settings' }).first().click()

    await expect(pageA.getByText('Sharing & sync')).toBeVisible()
    await expect(pageB.getByText('Sharing & sync')).toBeVisible()
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
