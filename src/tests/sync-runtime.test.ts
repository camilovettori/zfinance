import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlankState } from '@/domain/seed'
import { loadState, saveState, setActiveHouseholdId } from '@/services/storage'
import {
  activeSyncCoordinator,
  deactivateSyncRuntime,
  registerSyncedStateListener,
  restoreActiveSyncRuntime,
} from '@/sync/runtime'

const now = '2026-08-10T12:00:00.000Z'

const remoteRow = (id: string, householdId: string, payload: unknown) => ({
  id,
  household_id: householdId,
  payload,
  created_at: now,
  updated_at: now,
  created_by: 'user-a',
  updated_by: 'user-a',
  version: 1,
  deleted_at: null,
  client_updated_at: now,
  device_id: 'remote-device',
})

afterEach(() => {
  registerSyncedStateListener(null)
  deactivateSyncRuntime()
})

describe('active household runtime', () => {
  it('restores a valid active household and performs a read-only full pull outside Settings', async () => {
    const local = createBlankState()
    local.household.name = 'Legacy local household'
    await saveState(local)

    const remoteHouseholdId = crypto.randomUUID()
    const remoteHousehold = { ...local.household, id: remoteHouseholdId, name: 'HomeCoin Test' }
    const remoteAccount = {
      id: crypto.randomUUID(), householdId: remoteHouseholdId, name: 'Remote account', institution: '', type: 'current', currency: 'EUR',
      openingBalanceCents: 0, currentBalanceCents: 0, holder: '', accentColor: '#2F7D5B', archived: false, notes: '',
    }
    const membership = { id: crypto.randomUUID(), householdId: remoteHouseholdId, name: 'Owner', role: 'owner', color: '#2F7D5B', active: true }
    await setActiveHouseholdId(remoteHouseholdId)

    const rows = new Map<string, unknown[]>([
      ['households', [remoteRow(remoteHouseholdId, remoteHouseholdId, remoteHousehold)]],
      ['household_members', [remoteRow(membership.id, remoteHouseholdId, membership)]],
      ['financial_accounts', [remoteRow(remoteAccount.id, remoteHouseholdId, remoteAccount)]],
      ['categories', []],
      ['transactions', []],
      ['recurring_rules', []],
      ['settings', [remoteRow(remoteHouseholdId, remoteHouseholdId, { locale: 'en-IE', currency: 'EUR', weekStartDay: 1, financialMonthStartDay: 1 })]],
    ])
    const rpc = vi.fn().mockResolvedValue({ data: [{ household: remoteHousehold, membership }], error: null })
    const from = vi.fn((table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: async () => ({ data: rows.get(table) ?? [], error: null }),
      }
      return query
    })
    const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockResolvedValue(undefined) }
    const client = { rpc, from, channel: vi.fn(() => channel), removeChannel: vi.fn() } as unknown as SupabaseClient
    const received = vi.fn()
    registerSyncedStateListener(received)

    const selected = await restoreActiveSyncRuntime(client)

    expect(selected?.household.id).toBe(remoteHouseholdId)
    expect(from).toHaveBeenCalledTimes(7)
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ household: expect.objectContaining({ id: remoteHouseholdId }) }))
    expect((await loadState())?.accounts.map((account) => account.name)).toEqual(['Remote account'])
    expect(await activeSyncCoordinator()?.isReady()).toBe(true)
  })
})
