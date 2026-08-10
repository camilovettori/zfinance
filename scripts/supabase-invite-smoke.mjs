import crypto from 'node:crypto'
import { detectTools, identifyBrowserSafeKey, isLocalhostUrl, isServiceRoleKey, loadLocalEnv, maskKey, maskUrl } from './lib/sync-env.mjs'
import {
  createSmokeClient,
  householdPayload,
  isInviteRateLimitError,
  isTestNamespace,
  rpc,
  signIn,
  signOut,
  randomToken,
} from './lib/supabase-smoke.mjs'

const env = loadLocalEnv()

function skip(message) {
  console.log(message)
  process.exitCode = 0
}

function fail(message) {
  throw new Error(message)
}

function requireValue(value, message) {
  if (!value) throw new Error(message)
  return value
}

async function cleanupHousehold(client, householdId, householdName) {
  if (env.HOMECOIN_SMOKE_CLEANUP !== 'true') return
  if (!isTestNamespace(householdName)) return
  await rpc(client, 'leave_household', { p_household_id: householdId }).catch(() => {})
}

async function main() {
  if (env.VITE_SYNC_ENABLED !== 'true' || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    return skip('sync:invite-smoke skipped because cloud sync is not configured in the local environment.')
  }
  if (isServiceRoleKey(env.VITE_SUPABASE_ANON_KEY)) fail('A service-role key was supplied. Aborting.')
  if (isLocalhostUrl(env.VITE_SUPABASE_URL) && env.HOMECOIN_ALLOW_LOCALHOST_SUPABASE !== 'true') {
    return skip('sync:invite-smoke skipped because localhost validation is not enabled for cloud smoke testing.')
  }

  const userAEmail = requireValue(env.HOMECOIN_TEST_USER_A_EMAIL, 'HOMECOIN_TEST_USER_A_EMAIL is missing')
  const userAPassword = requireValue(env.HOMECOIN_TEST_USER_A_PASSWORD, 'HOMECOIN_TEST_USER_A_PASSWORD is missing')
  const userBEmail = requireValue(env.HOMECOIN_TEST_USER_B_EMAIL, 'HOMECOIN_TEST_USER_B_EMAIL is missing')
  const userBPassword = requireValue(env.HOMECOIN_TEST_USER_B_PASSWORD, 'HOMECOIN_TEST_USER_B_PASSWORD is missing')

  const clientA = createSmokeClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
  const clientB = createSmokeClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

  console.log(`Supabase URL: ${maskUrl(env.VITE_SUPABASE_URL)}`)
  console.log(`Supabase key: ${identifyBrowserSafeKey(env.VITE_SUPABASE_ANON_KEY)}, ${maskKey(env.VITE_SUPABASE_ANON_KEY)}`)
  for (const tool of detectTools()) console.log(`Tool check: ${tool.name} ${tool.available ? 'available' : 'missing'}`)

  await signIn(clientA, userAEmail, userAPassword)
  await signIn(clientB, userBEmail, userBPassword)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const householdId = crypto.randomUUID()
  const householdName = `smoke-${stamp}-${crypto.randomUUID().slice(0, 8)}-invite`
  const inviteToken = randomToken()

  try {
    await rpc(clientA, 'create_household', {
      p_id: householdId,
      p_name: householdName,
      p_payload: householdPayload(householdId, householdName),
      p_owner_name: 'Owner A',
      p_device_id: null,
    })

    const expiredInvite = await clientA.rpc('create_household_invite', {
      p_household_id: householdId,
      p_email: userBEmail.toLowerCase(),
      p_role: 'member',
      p_token: randomToken(),
      p_expires_at: new Date(Date.now() - 60_000).toISOString(),
    })
    if (!expiredInvite.error) fail('Expired invite creation was unexpectedly accepted.')

    let createdInvite
    try {
      createdInvite = await rpc(clientA, 'create_household_invite', {
        p_household_id: householdId,
        p_email: userBEmail.toLowerCase(),
        p_role: 'member',
        p_token: inviteToken,
        p_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      })
    } catch (error) {
      if (isInviteRateLimitError(error)) {
        console.log('Invite step: blocked by Supabase rate limit')
        await cleanupHousehold(clientA, householdId, householdName)
        return skip('sync:invite-smoke blocked by Supabase rate limit.')
      }
      throw error
    }

    if (!createdInvite?.id) fail('Invite creation did not return an id.')

    const wrongEmailAcceptance = await clientA.rpc('accept_household_invite', { p_token: inviteToken })
    if (!wrongEmailAcceptance.error) fail('An invitation was accepted by the wrong email address.')

    const accepted = await rpc(clientB, 'accept_household_invite', { p_token: inviteToken })
    if (!accepted?.membership?.id) fail('Invitation was not accepted.')

    const reusedInvite = await clientB.rpc('accept_household_invite', { p_token: inviteToken })
    if (!reusedInvite.error) fail('A used invitation token was accepted twice.')

    const memberInvite = await clientB.rpc('create_household_invite', {
      p_household_id: householdId,
      p_email: userAEmail.toLowerCase(),
      p_role: 'member',
      p_token: randomToken(),
      p_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    })
    if (!memberInvite.error) fail('A non-owner unexpectedly created an invitation.')

    const memberRemoval = await clientB.rpc('remove_household_member', {
      p_household_id: householdId,
      p_membership_id: accepted.membership.id,
    })
    if (!memberRemoval.error) fail('A non-owner unexpectedly removed a member.')

    console.log('Invite flow smoke validation completed successfully.')
    await cleanupHousehold(clientA, householdId, householdName)
    await cleanupHousehold(clientB, householdId, householdName)
  } finally {
    await signOut(clientA).catch(() => {})
    await signOut(clientB).catch(() => {})
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
