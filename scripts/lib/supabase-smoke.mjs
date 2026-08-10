import crypto from 'node:crypto'
import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from 'node:timers'
import { createClient } from '@supabase/supabase-js'
import { normalizeSupabaseUrl } from './sync-env.mjs'

const CLIENT_OPTIONS = {
  db: { schema: 'homecoin' },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}

function stringField(row, key, fallback = '') {
  const value = row?.[key]
  return typeof value === 'string' ? value : fallback
}

export function createSmokeClient(url, key) {
  return createClient(normalizeSupabaseUrl(url), key, CLIENT_OPTIONS)
}

export async function signIn(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(error?.message ?? `Failed to sign in ${email}`)
  return data.session
}

export async function signOut(client) {
  const { error } = await client.auth.signOut({ scope: 'local' })
  if (error) throw new Error(error.message)
}

export async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

export async function selectRows(client, table, filters = {}, columns = '*') {
  let query = client.from(table).select(columns)
  for (const [column, value] of Object.entries(filters)) {
    query = value === null ? query.is(column, null) : query.eq(column, value)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function selectOne(client, table, filters = {}, columns = '*') {
  const rows = await selectRows(client, table, filters, columns)
  if (!rows.length) throw new Error(`Expected one row from ${table}`)
  return rows[0]
}

export function randomToken() {
  return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`
}

export function householdPayload(id, name) {
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

export async function listMyHouseholds(client) {
  const data = await rpc(client, 'list_my_households')
  return Array.isArray(data) ? data : []
}

export function findSharedHousehold(householdsA, householdsB) {
  const byId = new Map(householdsB.map((entry) => [stringField(entry.household, 'id'), entry]))
  return householdsA
    .filter((entry) => byId.has(stringField(entry.household, 'id')))
    .sort((left, right) => new Date(stringField(right.household, 'createdAt', '1970-01-01')).getTime() - new Date(stringField(left.household, 'createdAt', '1970-01-01')).getTime())[0] ?? null
}

export function isTestNamespace(name) {
  return /^(smoke|e2e)-/i.test(name)
}

export function isInviteRateLimitError(error) {
  const message = String(error?.message ?? '').toLowerCase()
  return message.includes('rate limit') && message.includes('invitation')
}

export function normalizeSupabaseErrorMessage(error) {
  const message = String(error?.message ?? '').toLowerCase()
  if (message.includes('email not confirmed')) return 'email not confirmed'
  if (message.includes('invalid login credentials') || message.includes('invalid credentials')) return 'invalid credentials'
  if (message.includes('network') || message.includes('fetch')) return 'network/configuration error'
  return 'network/configuration error'
}

export function waitForRealtimeEvent(client, { table, householdId, event = '*', timeoutMs = 15_000 }) {
  return new Promise((resolve, reject) => {
    const channel = client.channel(`homecoin-smoke:${table}:${crypto.randomUUID()}`)
    const timer = setNodeTimeout(async () => {
      await client.removeChannel(channel)
      reject(new Error(`Timed out waiting for realtime ${table} event`))
    }, timeoutMs)
    channel.on('postgres_changes', {
      event,
      schema: 'homecoin',
      table,
      filter: `household_id=eq.${householdId}`,
    }, (payload) => {
      clearNodeTimeout(timer)
      void client.removeChannel(channel)
      resolve(payload)
    })
    void channel.subscribe().catch(async (error) => {
      clearNodeTimeout(timer)
      await client.removeChannel(channel)
      reject(error)
    })
  })
}
