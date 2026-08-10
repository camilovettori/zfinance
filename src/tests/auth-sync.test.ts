import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { AuthService } from '@/auth/auth-service'
import { createBlankState } from '@/domain/seed'
import { SupabaseHouseholdRepository } from '@/sync/repositories'
import { getSyncConfiguration } from '@/sync/config'

const session = { access_token: 'test-access-token', user: { id: 'user-a', email: 'one@example.com' } }

describe('Supabase authentication', () => {
  it('falls back to local-only without credentials and accepts only complete HTTPS config', () => {
    expect(getSyncConfiguration({ VITE_SYNC_ENABLED: 'true' } as ImportMetaEnv)).toMatchObject({ enabled: false, reason: 'missing-variables' })
    expect(getSyncConfiguration({ VITE_SYNC_ENABLED: 'true', VITE_SUPABASE_URL: 'http://remote.example', VITE_SUPABASE_ANON_KEY: 'a'.repeat(40) } as ImportMetaEnv)).toMatchObject({ enabled: false, reason: 'invalid-variables' })
    const serviceRole = `header.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`
    expect(getSyncConfiguration({ VITE_SYNC_ENABLED: 'true', VITE_SUPABASE_URL: 'https://project.supabase.co', VITE_SUPABASE_ANON_KEY: serviceRole } as ImportMetaEnv)).toMatchObject({ enabled: false, reason: 'invalid-variables' })
    expect(getSyncConfiguration({ VITE_SYNC_ENABLED: 'true', VITE_SUPABASE_URL: 'https://project.supabase.co', VITE_SUPABASE_ANON_KEY: 'a'.repeat(40) } as ImportMetaEnv)).toMatchObject({ enabled: true })
  })

  it('logs in with email/password and returns the persisted SDK session', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ data: { session }, error: null })
    const client = { auth: { signInWithPassword } } as unknown as SupabaseClient
    const result = await new AuthService(client).signIn('one@example.com', 'password-123')
    expect(result).toBe(session)
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'one@example.com', password: 'password-123' })
  })

  it('logs out locally without clearing HomeCoin financial storage', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const client = { auth: { signOut } } as unknown as SupabaseClient
    await new AuthService(client).signOut()
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('requests password recovery through the official SDK', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null })
    const client = { auth: { resetPasswordForEmail } } as unknown as SupabaseClient
    await new AuthService(client).requestPasswordReset('one@example.com')
    expect(resetPasswordForEmail).toHaveBeenCalledOnce()
  })

  it('sets a new password after a recovery session', async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: null })
    const client = { auth: { updateUser } } as unknown as SupabaseClient
    await new AuthService(client).updatePassword('new-password-123')
    expect(updateUser).toHaveBeenCalledWith({ password: 'new-password-123' })
  })
})

describe('household and one-time invitation RPCs', () => {
  const state = createBlankState()
  const membership = {
    id: crypto.randomUUID(), householdId: state.household.id, name: 'Owner', role: 'owner', color: '#2F7D5B', active: true,
  }

  it('creates a household and its owner membership atomically', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { household: state.household, membership }, error: null })
    const repository = new SupabaseHouseholdRepository({ rpc } as unknown as SupabaseClient)
    const created = await repository.create(state.household, 'Owner')
    expect(created.membership.role).toBe('owner')
    expect(rpc).toHaveBeenCalledWith('create_household', expect.objectContaining({ p_id: state.household.id }))
  })

  it('creates an expiring invite without returning a reusable database token', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: crypto.randomUUID(), expires_at: '2026-08-08T12:00:00.000Z' }, error: null })
    const repository = new SupabaseHouseholdRepository({ rpc } as unknown as SupabaseClient)
    const created = await repository.createInvite(state.household.id, 'two@example.com', '2026-08-08T12:00:00.000Z')
    expect(created.token.length).toBeGreaterThanOrEqual(32)
    expect(rpc).toHaveBeenCalledWith('create_household_invite', expect.objectContaining({ p_token: created.token, p_role: 'member' }))
  })

  it('accepts an invitation through the atomic server RPC', async () => {
    const joined = { ...membership, id: crypto.randomUUID(), name: 'two@example.com', role: 'member' }
    const rpc = vi.fn().mockResolvedValue({ data: { household: state.household, membership: joined }, error: null })
    const repository = new SupabaseHouseholdRepository({ rpc } as unknown as SupabaseClient)
    const result = await repository.acceptInvite('a'.repeat(43))
    expect(result.membership.role).toBe('member')
    expect(rpc).toHaveBeenCalledWith('accept_household_invite', { p_token: 'a'.repeat(43) })
  })
})
