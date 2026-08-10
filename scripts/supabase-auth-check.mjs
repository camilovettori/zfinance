import { createClient } from '@supabase/supabase-js'
import { identifyBrowserSafeKey, loadLocalEnv, maskKey, maskUrl, normalizeSupabaseUrl } from './lib/sync-env.mjs'

const env = loadLocalEnv()

function skip(message) {
  console.log(message)
  process.exitCode = 0
}

function requireValue(value, message) {
  if (!value) throw new Error(message)
  return value
}

function createAuthClient(url, key) {
  return createClient(normalizeSupabaseUrl(url), key, {
    db: { schema: 'homecoin' },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

function configured(value) {
  return value ? 'yes' : 'no'
}

function normalizeAuthError(error) {
  const message = String(error?.message ?? '').toLowerCase()
  if (message.includes('email not confirmed') || message.includes('not confirmed')) return 'email not confirmed'
  if (message.includes('invalid login credentials') || message.includes('invalid credentials')) return 'invalid credentials'
  return 'network/configuration error'
}

async function checkUser(label, client, email, password) {
  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    if (error || !data.session) {
      console.log(`${label} authentication: ${normalizeAuthError(error)}`)
      return false
    }
    console.log(`${label} authentication: OK`)
    return true
  } catch (error) {
    console.log(`${label} authentication: ${normalizeAuthError(error)}`)
    return false
  }
}

async function main() {
  if (env.VITE_SYNC_ENABLED !== 'true' || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    return skip('sync:auth-check skipped because cloud sync is not configured in the local environment.')
  }

  const userAEmail = env.HOMECOIN_TEST_USER_A_EMAIL
  const userAPassword = env.HOMECOIN_TEST_USER_A_PASSWORD
  const userBEmail = env.HOMECOIN_TEST_USER_B_EMAIL
  const userBPassword = env.HOMECOIN_TEST_USER_B_PASSWORD

  console.log(`Supabase URL: ${maskUrl(env.VITE_SUPABASE_URL)}`)
  console.log(`Supabase key: ${identifyBrowserSafeKey(env.VITE_SUPABASE_ANON_KEY)}, ${maskKey(env.VITE_SUPABASE_ANON_KEY)}`)
  console.log(`TEST USER A email configured: ${configured(userAEmail)}`)
  console.log(`TEST USER A password configured: ${configured(userAPassword)}`)
  console.log(`TEST USER B email configured: ${configured(userBEmail)}`)
  console.log(`TEST USER B password configured: ${configured(userBPassword)}`)
  console.log('Note: test users must already exist in Supabase Auth and use email/password login.')

  requireValue(userAEmail, 'HOMECOIN_TEST_USER_A_EMAIL is missing')
  requireValue(userAPassword, 'HOMECOIN_TEST_USER_A_PASSWORD is missing')
  requireValue(userBEmail, 'HOMECOIN_TEST_USER_B_EMAIL is missing')
  requireValue(userBPassword, 'HOMECOIN_TEST_USER_B_PASSWORD is missing')

  const clientA = createAuthClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
  const clientB = createAuthClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

  const okA = await checkUser('User A', clientA, userAEmail, userAPassword)
  const okB = await checkUser('User B', clientB, userBEmail, userBPassword)

  if (!okA || !okB) process.exitCode = 1
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
