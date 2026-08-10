import crypto from 'node:crypto'
import { detectTools, identifyBrowserSafeKey, isLocalhostUrl, isServiceRoleKey, loadLocalEnv, maskKey, maskUrl } from './lib/sync-env.mjs'
import {
  createSmokeClient,
  findSharedHousehold,
  householdPayload,
  isTestNamespace,
  listMyHouseholds,
  rpc,
  selectOne,
  selectRows,
  signIn,
  signOut,
  waitForRealtimeEvent,
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
    return skip('sync:smoke skipped because cloud sync is not configured in the local environment.')
  }
  if (isServiceRoleKey(env.VITE_SUPABASE_ANON_KEY)) fail('A service-role key was supplied. Aborting.')
  if (isLocalhostUrl(env.VITE_SUPABASE_URL) && env.HOMECOIN_ALLOW_LOCALHOST_SUPABASE !== 'true') {
    return skip('sync:smoke skipped because localhost validation is not enabled for cloud smoke testing.')
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

  const sessionA = await signIn(clientA, userAEmail, userAPassword)
  const sessionB = await signIn(clientB, userBEmail, userBPassword)

  const userAId = sessionA.user.id
  const userBId = sessionB.user.id
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const smokePrefix = `smoke-${stamp}-${crypto.randomUUID().slice(0, 8)}`

  try {
    const householdsA = await listMyHouseholds(clientA)
    const householdsB = await listMyHouseholds(clientB)
    const sharedHousehold = findSharedHousehold(householdsA, householdsB)
    if (!sharedHousehold) {
      return skip('sync:smoke skipped because no shared smoke household exists yet. Run pnpm sync:invite-smoke once to seed one.')
    }

    console.log(`Invite step: skipped, users already share test household ${sharedHousehold.household.name}`)

    const sharedHouseholdId = sharedHousehold.household.id
    const privateHouseholdId = crypto.randomUUID()
    const privateHouseholdName = `${smokePrefix}-private`

    await rpc(clientA, 'create_household', {
      p_id: privateHouseholdId,
      p_name: privateHouseholdName,
      p_payload: householdPayload(privateHouseholdId, privateHouseholdName),
      p_owner_name: 'Owner A',
      p_device_id: null,
    })

    const sharedHouseholdVisible = await selectRows(clientB, 'households', { id: sharedHouseholdId })
    if (!sharedHouseholdVisible.length) fail('User B unexpectedly could not see the shared smoke household.')

    const privateHouseholdVisible = await selectRows(clientB, 'households', { id: privateHouseholdId })
    if (privateHouseholdVisible.length) fail('User B unexpectedly saw the private smoke household.')

    const privateHouseholdTransactions = await selectRows(clientB, 'transactions', { household_id: privateHouseholdId })
    if (privateHouseholdTransactions.length) fail('User B unexpectedly saw private smoke transactions.')

    const sharedTransactionId = crypto.randomUUID()
    const sharedTransactionPayload = {
      id: sharedTransactionId,
      householdId: sharedHouseholdId,
      title: `${smokePrefix} shared transaction`,
      amountCents: 12_345,
      transactionDate: '2026-08-06',
      kind: 'expense',
      status: 'pending',
    }
    const created = await clientA.from('transactions').insert({
      id: sharedTransactionId,
      household_id: sharedHouseholdId,
      payload: sharedTransactionPayload,
      created_by: userBId,
      updated_by: userBId,
      client_updated_at: new Date().toISOString(),
    }).select('id, version, created_by, updated_by').single()
    if (created.error) throw new Error(created.error.message)
    if (created.data.created_by !== userAId || created.data.updated_by !== userAId) {
      fail('created_by or updated_by were not normalized on insert.')
    }
    if (created.data.version !== 1) fail('Initial transaction version was not 1.')

    const pulled = await selectOne(clientB, 'transactions', { household_id: sharedHouseholdId, id: sharedTransactionId }, 'id, version, payload')
    if (pulled.version !== 1) fail('Initial transaction version was not 1 for the shared member.')

    const memberUpdate = await clientB.from('transactions')
      .update({
        payload: {
          ...sharedTransactionPayload,
          title: `${smokePrefix} shared transaction updated`,
        },
        updated_by: userAId,
        client_updated_at: new Date(Date.now() + 1_000).toISOString(),
      })
      .eq('id', sharedTransactionId)
      .eq('household_id', sharedHouseholdId)
      .eq('version', 1)
      .select('id, version, updated_by')
    if (memberUpdate.error) throw new Error(memberUpdate.error.message)
    if (!memberUpdate.data?.length) fail('Member update did not succeed at the expected version.')
    if (memberUpdate.data[0].version !== 2) fail('Version did not increment after the member update.')
    if (memberUpdate.data[0].updated_by !== userBId) fail('updated_by was not normalized on update.')

    const staleUpdate = await clientA.from('transactions')
      .update({
        payload: {
          ...sharedTransactionPayload,
          title: `${smokePrefix} stale update`,
        },
        client_updated_at: new Date(Date.now() + 2_000).toISOString(),
      })
      .eq('id', sharedTransactionId)
      .eq('household_id', sharedHouseholdId)
      .eq('version', 1)
      .select('id')
    if (staleUpdate.error) throw new Error(staleUpdate.error.message)
    if (staleUpdate.data?.length) fail('A stale update unexpectedly succeeded.')

    const pullTransactionId = crypto.randomUUID()
    const pullTransactionPayload = {
      id: pullTransactionId,
      householdId: sharedHouseholdId,
      title: `${smokePrefix} pull transaction`,
      amountCents: 3_210,
      transactionDate: '2026-08-07',
      kind: 'income',
      status: 'completed',
    }
    const pullCreate = await clientA.from('transactions').insert({
      id: pullTransactionId,
      household_id: sharedHouseholdId,
      payload: pullTransactionPayload,
      client_updated_at: new Date().toISOString(),
    }).select('id, version').single()
    if (pullCreate.error) throw new Error(pullCreate.error.message)
    if (pullCreate.data.version !== 1) fail('Initial pull transaction version was not 1.')

    const pulledRows = await selectRows(clientB, 'transactions', { household_id: sharedHouseholdId, id: pullTransactionId }, 'id, version, payload')
    if (pulledRows.length !== 1) fail('Manual pull did not return the new shared transaction.')

    const realtimeEventPromise = waitForRealtimeEvent(clientB, {
      table: 'transactions',
      householdId: sharedHouseholdId,
      event: 'UPDATE',
    })
    const realtimeUpdate = await clientA.from('transactions')
      .update({
        payload: {
          ...pullTransactionPayload,
          title: `${smokePrefix} realtime update`,
        },
        client_updated_at: new Date(Date.now() + 3_000).toISOString(),
      })
      .eq('id', pullTransactionId)
      .eq('household_id', sharedHouseholdId)
      .eq('version', 1)
      .select('id, version, payload')
      .single()
    if (realtimeUpdate.error) throw new Error(realtimeUpdate.error.message)
    if (realtimeUpdate.data.version !== 2) fail('Realtime update did not increment the version.')
    const realtimeEvent = await realtimeEventPromise
    const realtimeRow = realtimeEvent?.new ?? realtimeEvent?.old
    if (!realtimeRow || realtimeRow.id !== pullTransactionId) fail('Realtime event did not arrive for the updated transaction.')

    const tombstone = await clientA.from('transactions')
      .update({
        deleted_at: new Date().toISOString(),
        client_updated_at: new Date(Date.now() + 4_000).toISOString(),
      })
      .eq('id', sharedTransactionId)
      .eq('household_id', sharedHouseholdId)
      .eq('version', 2)
      .select('id, version, deleted_at')
      .single()
    if (tombstone.error) throw new Error(tombstone.error.message)
    if (!tombstone.data.deleted_at) fail('Soft delete did not write a tombstone.')

    const hiddenTombstone = await selectRows(clientB, 'transactions', {
      household_id: sharedHouseholdId,
      id: sharedTransactionId,
      deleted_at: null,
    })
    if (hiddenTombstone.length !== 0) fail('A tombstoned transaction was unexpectedly visible to the shared member.')

    await cleanupHousehold(clientA, privateHouseholdId, privateHouseholdName)

    console.log('Core smoke validation completed successfully.')
  } finally {
    await signOut(clientA).catch(() => {})
    await signOut(clientB).catch(() => {})
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
