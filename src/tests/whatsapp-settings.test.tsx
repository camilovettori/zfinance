import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WhatsAppSettings } from '@/components/WhatsAppSettings'
import { createDemoState } from '@/domain/seed'
import { getSupabaseClient } from '@/sync/supabase-client'

vi.mock('@/sync/supabase-client', () => ({ getSupabaseClient: vi.fn() }))
const clientMock = vi.mocked(getSupabaseClient)
describe('WhatsApp settings', () => {
  beforeEach(() => clientMock.mockReturnValue(null))
  it('explains how to connect when cloud sync is unavailable', () => {
    render(<WhatsAppSettings state={createDemoState()} />)
    expect(screen.getByText('Sign in to cloud sync to connect WhatsApp.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send test message' })).toBeNull()
  })
  it('does not expose an actionable form before the backend is configured', async () => {
    const client = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: 'missing table' } }) }) }) }
    clientMock.mockReturnValue(client as unknown as NonNullable<ReturnType<typeof getSupabaseClient>>)
    render(<WhatsAppSettings state={createDemoState()} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('setup is pending'))
    expect(screen.queryByRole('button', { name: 'Create verification code' })).toBeNull()
  })
  it('normalizes an international number, requires consent, and never sends server secrets from the form', async () => {
    const state = createDemoState()
    const insert = vi.fn().mockResolvedValue({ error: null })
    const builder = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }), insert,
      then(resolve: (value: unknown) => void) { return Promise.resolve({ data: [], error: null }).then(resolve) },
    }
    clientMock.mockReturnValue({ from: () => builder } as unknown as NonNullable<ReturnType<typeof getSupabaseClient>>)
    render(<WhatsAppSettings state={state} />)
    await screen.findByRole('button', { name: 'Create verification code' })
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Name'), 'Camilo')
    await user.type(screen.getByLabelText('WhatsApp number'), '+353 (87) 000-0001')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Create verification code' }))
    await waitFor(() => expect(insert).toHaveBeenCalledOnce())
    expect(insert.mock.calls[0][0]).toMatchObject({ household_id: state.household.id, member_name: 'Camilo', phone_number: '353870000001' })
    expect(Object.keys(insert.mock.calls[0][0]).sort()).toEqual(['account_id', 'category_id', 'household_id', 'member_name', 'phone_number'])
  })
})
