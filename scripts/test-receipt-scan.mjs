// Live opt-in smoke test: synthetic receipt, existing test household, no expense insert.
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
import { loadLocalEnv } from './lib/sync-env.mjs'
const { FormData, Blob, fetch } = globalThis

const env = loadLocalEnv()
const url = new URL(env.VITE_SUPABASE_URL).origin
const client = createClient(url, env.VITE_SUPABASE_ANON_KEY, { db: { schema: 'homecoin' }, auth: { persistSession: false, autoRefreshToken: false } })
const signed = await client.auth.signInWithPassword({ email: env.HOMECOIN_TEST_USER_A_EMAIL, password: env.HOMECOIN_TEST_USER_A_PASSWORD })
if (signed.error) throw new Error('Test login unavailable')
const households = await client.from('households').select('id,payload').is('deleted_at', null).limit(1)
if (households.error || !households.data?.length) throw new Error('No existing test household')
const household = households.data[0]
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 500, height: 450 } })
  await page.setContent('<body style="margin:0;padding:32px;font:24px monospace;background:white;color:black"><h2>TEST MARKET</h2><p>2026-11-04</p><p>Groceries 19.99</p><hr><strong>TOTAL ' + household.payload.currency + ' 19.99</strong></body>')
  const png = await page.screenshot()
  const body = new FormData()
  body.append('householdId', household.id)
  body.append('image', new Blob([png], { type: 'image/png' }), 'test-receipt.png')
  const response = await fetch(url + '/functions/v1/receipt-scan', { method: 'POST', headers: { Authorization: 'Bearer ' + signed.data.session.access_token, apikey: env.VITE_SUPABASE_ANON_KEY, Origin: 'https://zfinance-phi.vercel.app' }, body })
  const data = await response.json()
  console.log(JSON.stringify({ status: response.status, amountCorrect: data.receipt?.total_amount === 1999, dateCorrect: data.receipt?.date === '2026-11-04', financialTransactionsCreated: 0, error: data.error }))
  if (!response.ok || data.receipt?.total_amount !== 1999) process.exitCode = 1
} finally {
  await browser.close()
  await client.auth.signOut({ scope: 'local' })
}
