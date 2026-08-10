import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { HOMECOIN_SCHEMA } from '@/sync/schema'

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}))

const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '202608100001_homecoin_schema.sql')
const rlsPath = path.join(process.cwd(), 'supabase', 'tests', 'rls.sql')

describe('HomeCoin schema wiring', () => {
  it('configures the default Supabase client and realtime subscriptions for homecoin', async () => {
    vi.doMock('@/sync/config', () => ({
      syncConfiguration: {
        enabled: true,
        url: 'https://project.supabase.co',
        anonKey: 'anon-key',
      },
    }))

    const channel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockResolvedValue(undefined),
    }
    const scopedClient = {
      channel: vi.fn().mockReturnValue(channel),
      removeChannel: vi.fn(),
      from: vi.fn(),
      rpc: vi.fn(),
    }
    const rootClient = scopedClient
    createClientMock.mockReturnValue(rootClient)

    const { getSupabaseClient, resetSupabaseClientForTests } = await import('@/sync/supabase-client')
    const { SupabaseSyncProvider } = await import('@/sync/supabase-provider')

    resetSupabaseClientForTests()
    expect(getSupabaseClient()).toBe(rootClient)
    expect(createClientMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ db: { schema: HOMECOIN_SCHEMA } }),
    )

    const provider = new SupabaseSyncProvider(rootClient as never, 'household-1', 'device-1')

    await provider.subscribe(vi.fn())
    expect(channel.on).toHaveBeenCalled()
    expect(channel.on.mock.calls.every(([, options]) => (
      options.schema === HOMECOIN_SCHEMA
      && options.table
      && typeof options.filter === 'string'
    ))).toBe(true)

    vi.doUnmock('@/sync/config')
    vi.resetModules()
  })

  it('keeps HomeCoin objects qualified away from public and preserves auth references', () => {
    const migration = readFileSync(migrationPath, 'utf8')
    const rls = readFileSync(rlsPath, 'utf8')

    for (const source of [migration, rls]) {
      expect(source).not.toMatch(/\bpublic\.(households|household_members|household_invites|financial_accounts|categories|transactions|recurring_rules|settings|sync_audit_events|is_household_member|is_household_owner|set_sync_insert_metadata|touch_sync_row|create_household|list_my_households|create_household_invite|accept_household_invite|remove_household_member|leave_household|household_role)\b/)
    }

    expect(migration).toContain('create schema if not exists homecoin')
    expect(migration).toContain('create type homecoin.household_role as enum')
    expect(migration).toContain('auth.users')
    expect(migration).toContain('auth.uid()')
    expect(rls).toContain('create or replace function public.set_test_claims')
    expect(rls).toContain('homecoin.create_household(')
  })

  it('keeps sync disabled when VITE_SYNC_ENABLED=false', async () => {
    const { getSyncConfiguration } = await import('@/sync/config')
    expect(getSyncConfiguration({ VITE_SYNC_ENABLED: 'false' } as ImportMetaEnv)).toMatchObject({
      enabled: false,
      reason: 'disabled',
    })
  })
})
