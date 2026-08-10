import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { detectTools, identifyBrowserSafeKey, isLocalhostUrl, isServiceRoleKey, loadLocalEnv, maskKey, maskUrl, normalizeSupabaseUrl } from './lib/sync-env.mjs'

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

function createBrowserClient(url, key) {
  return createClient(normalizeSupabaseUrl(url), key, {
    db: {
      schema: 'homecoin',
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

async function signIn(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(error?.message ?? `Failed to sign in ${email}`)
  return data.session
}

async function signOut(client) {
  const { error } = await client.auth.signOut({ scope: 'local' })
  if (error) throw new Error(error.message)
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

async function selectRows(client, table, filters = {}, columns = '*') {
  let query = client.from(table).select(columns)
  for (const [column, value] of Object.entries(filters)) {
    query = value === null ? query.is(column, null) : query.eq(column, value)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

async function selectOne(client, table, filters = {}, columns = '*') {
  const rows = await selectRows(client, table, filters, columns)
  if (!rows.length) throw new Error(`Expected one row from ${table}`)
  return rows[0]
}

function randomToken() {
  return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`
}

function householdPayload(id, name) {
  return {
    id,
    name,
    currency: 'EUR',
    locale: 'en-IE',
    financialMonthStartDay: 1,
    weekStartDay: 1,
    createdAt: new Date().toISOString(),
  }
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
  const clientA = createBrowserClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
  const clientB = createBrowserClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

  console.log(`Supabase URL: ${maskUrl(env.VITE_SUPABASE_URL)}`)
  console.log(`Supabase key: ${identifyBrowserSafeKey(env.VITE_SUPABASE_ANON_KEY)}, ${maskKey(env.VITE_SUPABASE_ANON_KEY)}`)
  for (const tool of detectTools()) console.log(`Tool check: ${tool.name} ${tool.available ? 'available' : 'missing'}`)

  const sessionA = await signIn(clientA, userAEmail, userAPassword)
  const sessionB = await signIn(clientB, userBEmail, userBPassword)

  const userAId = sessionA.user.id
  const userBId = sessionB.user.id

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const prefix = `e2e-${stamp}-${crypto.randomUUID().slice(0, 8)}`
  const householdA = crypto.randomUUID()
  const householdB = crypto.randomUUID()
  const householdC = crypto.randomUUID()
  const transactionA = crypto.randomUUID()
  const transactionB = crypto.randomUUID()
  const recurringRuleA = crypto.randomUUID()

  const inviteAForB = randomToken()
  const inviteBForB = randomToken()
  const inviteCForB = randomToken()

  let membershipBInA

  try {
    await rpc(clientA, 'create_household', {
      p_id: householdA,
      p_name: `${prefix}-household-a`,
      p_payload: householdPayload(householdA, `${prefix}-household-a`),
      p_owner_name: 'Owner A',
      p_device_id: null,
    })
    await rpc(clientA, 'create_household', {
      p_id: householdB,
      p_name: `${prefix}-household-b`,
      p_payload: householdPayload(householdB, `${prefix}-household-b`),
      p_owner_name: 'Owner A',
      p_device_id: null,
    })
    await rpc(clientA, 'create_household', {
      p_id: householdC,
      p_name: `${prefix}-household-c`,
      p_payload: householdPayload(householdC, `${prefix}-household-c`),
      p_owner_name: 'Owner A',
      p_device_id: null,
    })

    await rpc(clientA, 'create_household_invite', {
      p_household_id: householdA,
      p_email: userBEmail.toLowerCase(),
      p_role: 'member',
      p_token: inviteAForB,
      p_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    })
    await rpc(clientA, 'create_household_invite', {
      p_household_id: householdB,
      p_email: userBEmail.toLowerCase(),
      p_role: 'member',
      p_token: inviteBForB,
      p_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    })
    await rpc(clientA, 'create_household_invite', {
      p_household_id: householdC,
      p_email: userBEmail.toLowerCase(),
      p_role: 'member',
      p_token: inviteCForB,
      p_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    })

    const expiredInvite = await clientA.rpc('create_household_invite', {
      p_household_id: householdA,
      p_email: userBEmail.toLowerCase(),
      p_role: 'member',
      p_token: randomToken(),
      p_expires_at: new Date(Date.now() - 60_000).toISOString(),
    })
    if (!expiredInvite.error) fail('Expected expired invite creation to be rejected.')

    const outsiderHousehold = await selectRows(clientB, 'households', { id: householdA })
    if (outsiderHousehold.length !== 0) fail('User B unexpectedly saw household A before accepting the invite.')
    const outsiderTransactions = await selectRows(clientB, 'transactions', { household_id: householdA })
    if (outsiderTransactions.length !== 0) fail('User B unexpectedly saw household A transactions before accepting the invite.')
    const outsiderRules = await selectRows(clientB, 'recurring_rules', { household_id: householdA })
    if (outsiderRules.length !== 0) fail('User B unexpectedly saw household A recurring rules before accepting the invite.')

    const recurringCreate = await clientA.from('recurring_rules').insert({
      id: recurringRuleA,
      household_id: householdA,
      payload: {
        id: recurringRuleA,
        householdId: householdA,
        name: `${prefix} recurring A`,
        amountCents: 4_200,
        nextDueDate: '2026-08-20',
      },
      client_updated_at: new Date().toISOString(),
    })
    if (recurringCreate.error) throw new Error(recurringCreate.error.message)

    const recurringForbidden = await clientB.from('recurring_rules')
      .update({ payload: { name: `${prefix} forbidden` } })
      .eq('household_id', householdA)
      .eq('id', recurringRuleA)
      .select('id')
    if (recurringForbidden.error) throw new Error(recurringForbidden.error.message)
    if (recurringForbidden.data?.length) fail('A non-member should not be able to edit recurring rules.')

    membershipBInA = await rpc(clientB, 'accept_household_invite', { p_token: inviteAForB })
    const reusedInvite = await clientB.rpc('accept_household_invite', { p_token: inviteAForB })
    if (!reusedInvite.error) fail('A used invitation token was accepted twice.')

    const wrongEmailAcceptance = await clientA.rpc('accept_household_invite', { p_token: inviteBForB })
    if (!wrongEmailAcceptance.error) fail('An invitation was accepted by the wrong email address.')
    await signIn(clientB, userBEmail, userBPassword)

    const memberInvite = await clientB.rpc('create_household_invite', {
      p_household_id: householdA,
      p_email: userAEmail.toLowerCase(),
      p_role: 'member',
      p_token: randomToken(),
      p_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    })
    if (!memberInvite.error) fail('A non-owner unexpectedly created an invitation.')

    const memberRemoval = await clientB.rpc('remove_household_member', {
      p_household_id: householdA,
      p_membership_id: membershipBInA.membership.id,
    })
    if (!memberRemoval.error) fail('A non-owner unexpectedly removed a member.')

    const transactionCreate = await clientA.from('transactions').insert({
      id: transactionA,
      household_id: householdA,
      payload: {
        id: transactionA,
        householdId: householdA,
        title: `${prefix} transaction A`,
        amountCents: 12_345,
        transactionDate: '2026-08-06',
        kind: 'expense',
        status: 'pending',
      },
      created_by: userBId,
      updated_by: userBId,
      client_updated_at: new Date().toISOString(),
    }).select('id, version, created_by, updated_by')
    if (transactionCreate.error) throw new Error(transactionCreate.error.message)
    if (!transactionCreate.data?.length) fail('Transaction insert returned no rows.')
    if (transactionCreate.data[0].created_by !== userAId || transactionCreate.data[0].updated_by !== userAId) {
      fail('created_by or updated_by were not normalized on insert.')
    }

    const readableByMember = await selectOne(clientB, 'transactions', { household_id: householdA, id: transactionA }, 'id, version, payload')
    if (readableByMember.version !== 1) fail('Initial transaction version was not 1.')

    const memberUpdate = await clientB.from('transactions')
      .update({
        payload: {
          id: transactionA,
          householdId: householdA,
          title: `${prefix} transaction A updated`,
          amountCents: 12_345,
          transactionDate: '2026-08-06',
          kind: 'expense',
          status: 'pending',
        },
        updated_by: userAId,
        client_updated_at: new Date(Date.now() + 1_000).toISOString(),
      })
      .eq('id', transactionA)
      .eq('household_id', householdA)
      .eq('version', 1)
      .select('id, version, updated_by')
    if (memberUpdate.error) throw new Error(memberUpdate.error.message)
    if (!memberUpdate.data?.length) fail('Member update did not succeed at the expected version.')
    if (memberUpdate.data[0].version !== 2) fail('Version did not increment after the member update.')
    if (memberUpdate.data[0].updated_by !== userBId) fail('updated_by was not normalized on update.')

    const staleUpdate = await clientA.from('transactions')
      .update({
        payload: {
          id: transactionA,
          householdId: householdA,
          title: `${prefix} stale update`,
          amountCents: 12_345,
          transactionDate: '2026-08-06',
          kind: 'expense',
          status: 'pending',
        },
        client_updated_at: new Date(Date.now() + 2_000).toISOString(),
      })
      .eq('id', transactionA)
      .eq('household_id', householdA)
      .eq('version', 1)
      .select('id')
    if (staleUpdate.error) throw new Error(staleUpdate.error.message)
    if (staleUpdate.data?.length) fail('A stale update unexpectedly succeeded.')

    const secondHouseholdInsert = await clientA.from('transactions').insert({
      id: transactionB,
      household_id: householdB,
      payload: {
        id: transactionB,
        householdId: householdB,
        title: `${prefix} transaction B`,
        amountCents: 3_210,
        transactionDate: '2026-08-07',
        kind: 'income',
        status: 'completed',
      },
      client_updated_at: new Date().toISOString(),
    })
    if (secondHouseholdInsert.error) throw new Error(secondHouseholdInsert.error.message)
    const householdACount = await selectRows(clientA, 'transactions', { household_id: householdA })
    const householdBCount = await selectRows(clientA, 'transactions', { household_id: householdB })
    if (householdACount.length !== 1 || householdBCount.length !== 1) fail('Isolated household counts did not match expectation.')

    const membershipBInB = await rpc(clientB, 'accept_household_invite', { p_token: inviteBForB })
    void membershipBInB
    const leaveHouseholdB = await rpc(clientB, 'leave_household', { p_household_id: householdB })
    void leaveHouseholdB
    const afterLeave = await selectRows(clientB, 'transactions', { household_id: householdB })
    if (afterLeave.length !== 0) fail('A member who left still had access to the household.')

    const removeBFromA = await rpc(clientA, 'remove_household_member', {
      p_household_id: householdA,
      p_membership_id: membershipBInA.membership.id,
    })
    void removeBFromA
    const removedAccess = await selectRows(clientB, 'transactions', { household_id: householdA })
    if (removedAccess.length !== 0) fail('A removed member still had access.')

    await rpc(clientB, 'accept_household_invite', { p_token: inviteCForB })
    const leaveHouseholdC = await rpc(clientA, 'leave_household', { p_household_id: householdC })
    void leaveHouseholdC
    const promotedMember = await selectOne(clientB, 'household_members', { household_id: householdC, user_id: userBId, deleted_at: null }, 'role')
    if (promotedMember.role !== 'owner') fail('A successor was not promoted to owner.')

    const tombstoneUpdate = await clientA.from('transactions')
      .update({
        deleted_at: new Date().toISOString(),
        client_updated_at: new Date(Date.now() + 3_000).toISOString(),
      })
      .eq('id', transactionB)
      .eq('household_id', householdB)
      .eq('version', 1)
      .select('id, version, deleted_at')
    if (tombstoneUpdate.error) throw new Error(tombstoneUpdate.error.message)
    if (!tombstoneUpdate.data?.length) fail('Soft delete did not succeed.')

    const outsiderAfterLeave = await selectRows(clientB, 'transactions', { household_id: householdB })
    if (outsiderAfterLeave.length !== 0) fail('A tombstone was unexpectedly visible to an external household.')

    if (env.HOMECOIN_SMOKE_CLEANUP === 'true') {
      await signIn(clientA, userAEmail, userAPassword)
      await signIn(clientB, userBEmail, userBPassword)
      await rpc(clientA, 'leave_household', { p_household_id: householdA }).catch(() => {})
      await rpc(clientA, 'leave_household', { p_household_id: householdB }).catch(() => {})
      await rpc(clientB, 'leave_household', { p_household_id: householdC }).catch(() => {})
    }

    console.log('Smoke validation completed successfully.')
  } finally {
    await signOut(clientA).catch(() => {})
    await signOut(clientB).catch(() => {})
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
