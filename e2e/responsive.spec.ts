import { expect, test, type Page } from '@playwright/test'

const dashboard = (page: Page) => page.getByRole('region', { name: 'Mobile household dashboard' })
  .or(page.getByRole('heading', { name: /^Good / })).first()

async function loadSampleHousehold(page: Page) {
  await page.goto('/')
  const setup = page.getByRole('heading', { name: "Let's set up your household plan" })
  const loadedDashboard = dashboard(page)
  await setup.or(loadedDashboard).first().waitFor({ state: 'visible' })
  if (await setup.isVisible()) await page.getByRole('button', { name: 'Load sample data' }).click()
  await expect(loadedDashboard).toBeVisible()
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
]) {
  test(`mobile shell and Planner fit ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await loadSampleHousehold(page)
    await expect(page.getByText('Available now')).toBeVisible()
    await expect(page.getByText('After tomorrow')).toBeVisible()
    await expect(page.getByText(/Safe to spend|Committed first|Then income/i)).toHaveCount(0)
    await expect(page.locator('.app-sidebar')).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible()
    await page.getByRole('button', { name: 'Planner' }).click()
    await expect(page.getByRole('region', { name: 'Mobile financial planner' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'true')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
}

test('desktop preserves the sidebar and seven-column Planner', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await loadSampleHousehold(page)
  await expect(page.locator('.app-sidebar')).toBeVisible()
  await page.getByRole('button', { name: 'Planner' }).click()
  await expect(page.locator('.planning-day-grid').first().locator(':scope > *')).toHaveCount(7)
})

test('mobile Reports uses filter and action sheets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loadSampleHousehold(page)
  await page.getByRole('button', { name: 'More sections' }).click()
  await page.getByRole('dialog', { name: 'More sections' }).getByRole('button', { name: 'Reports' }).click()
  await page.getByRole('button', { name: 'Filters' }).click()
  await expect(page.getByRole('dialog', { name: 'Report filters' })).toBeVisible()
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await page.getByRole('button', { name: 'Actions' }).click()
  await expect(page.getByRole('dialog', { name: 'Report actions' })).toBeVisible()
})

test('production app shell reloads offline with IndexedDB data', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loadSampleHousehold(page)
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload()
  await expect(dashboard(page)).toBeVisible()
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(dashboard(page)).toBeVisible()
  await context.setOffline(false)
})
