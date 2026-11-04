import { expect, test } from '@playwright/test'

test('mobile receipt scanner opens from quick add and fits a narrow screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/')
  const setup = page.getByRole('heading', { name: "Let's set up your household plan" })
  await setup.or(page.getByRole('region', { name: 'Mobile household dashboard' })).first().waitFor({ state: 'visible' })
  if (await setup.isVisible()) await page.getByRole('button', { name: 'Load sample data' }).click()
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'Scan receipt', exact: true }).click()
  const scanner = page.getByRole('dialog', { name: 'Scan a receipt' })
  await expect(scanner).toBeVisible()
  await expect(scanner.getByLabel('Receipt photo')).toBeVisible()
  await expect(scanner.getByRole('button', { name: 'Save paid expense' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('receipt-scanner-mobile.png') })
  await page.keyboard.press('Escape')
  await expect(scanner).toHaveCount(0)
})
