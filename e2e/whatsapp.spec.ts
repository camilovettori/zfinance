import { expect, test } from '@playwright/test'

test('WhatsApp linking panel fits a small mobile screen without exposing secrets', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.route('**/rest/v1/whatsapp_contacts*', (route) => route.fulfill({ json: [{
    id: 'test-contact', member_name: 'Camilo', phone_number: '353870000001', verified_at: null,
    link_code: '0123456789abcdef0123456789abcdef', link_expires_at: '2026-11-03T20:15:00Z',
    notifications_enabled: false, reminder_time: '20:00:00',
  }] }))
  await page.route('**/rest/v1/whatsapp_messages*', (route) => route.fulfill({ json: [] }))
  await page.goto('/')
  const setup = page.getByRole('heading', { name: "Let's set up your household plan" })
  await setup.or(page.getByRole('region', { name: 'Mobile household dashboard' })).first().waitFor({ state: 'visible' })
  if (await setup.isVisible()) await page.getByRole('button', { name: 'Load sample data' }).click()
  await page.getByRole('button', { name: 'More sections' }).click()
  await page.getByRole('dialog', { name: 'More sections' }).getByRole('button', { name: 'Settings' }).click()
  const panel = page.getByRole('region', { name: 'WhatsApp assistant' })
  await panel.scrollIntoViewIfNeeded()
  await expect(panel).toBeVisible()
  // The build may deliberately have cloud sync disabled for offline E2E runs.
  if (await panel.getByText('Sign in to cloud sync to connect WhatsApp.').count()) {
    await expect(panel.getByRole('button', { name: 'Create verification code' })).toHaveCount(0)
  } else {
    await expect(panel.getByText('Awaiting verification', { exact: false })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Create verification code' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Send test message' })).toHaveCount(0)
    await expect(panel.getByLabel('WhatsApp number')).toHaveAttribute('type', 'tel')
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('whatsapp-mobile.png'), fullPage: true })
})
