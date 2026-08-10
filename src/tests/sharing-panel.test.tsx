import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SharingPanel } from '@/components/sync/SharingPanel'
import { createBlankState } from '@/domain/seed'

const syncMocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  members: vi.fn(),
  createInvite: vi.fn(),
  acceptInvite: vi.fn(),
  removeMember: vi.fn(),
  leave: vi.fn(),
  activateSyncRuntime: vi.fn(),
  uploadLocalState: vi.fn(),
}))

const authMocks = vi.hoisted(() => ({
  session: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@/auth/auth-service', () => ({
  AuthService: class {
    session = authMocks.session
    onAuthStateChange = authMocks.onAuthStateChange
    signOut = authMocks.signOut
  },
}))

vi.mock('@/sync', async () => {
  const actual = await vi.importActual<typeof import('@/sync')>('@/sync')
  return {
    ...actual,
    syncConfiguration: { enabled: true, url: 'https://example.supabase.co', anonKey: 'test-key' },
    getSupabaseClient: () => ({}),
    SupabaseHouseholdRepository: class {
      list = syncMocks.list
      create = syncMocks.create
      members = syncMocks.members
      createInvite = syncMocks.createInvite
      acceptInvite = syncMocks.acceptInvite
      removeMember = syncMocks.removeMember
      leave = syncMocks.leave
    },
    activateSyncRuntime: syncMocks.activateSyncRuntime,
    activeSyncCoordinator: () => ({ uploadLocalState: syncMocks.uploadLocalState }),
    deactivateSyncRuntime: vi.fn(),
  }
})

describe('SharingPanel household creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMocks.session.mockResolvedValue({ user: { email: 'owner@example.com' } })
    authMocks.onAuthStateChange.mockReturnValue(() => undefined)
    syncMocks.members.mockResolvedValue([])
    syncMocks.activateSyncRuntime.mockResolvedValue({ isReady: vi.fn().mockResolvedValue(false) })
  })

  it('creates and selects another household without uploading local data', async () => {
    const user = userEvent.setup()
    const state = createBlankState()
    const existing = {
      household: { ...state.household, id: 'existing-household', name: 'Existing household' },
      membership: { id: 'existing-member', householdId: 'existing-household', name: 'Owner', role: 'owner', color: '#2F7D5B', active: true },
    }
    syncMocks.list.mockResolvedValue([existing])
    syncMocks.create.mockImplementation(async (household, ownerName) => ({
      household,
      membership: { id: 'new-member', householdId: household.id, name: ownerName, role: 'owner', color: '#2F7D5B', active: true },
    }))
    const onStateChanged = vi.fn()

    render(<SharingPanel state={state} onStateChanged={onStateChanged} />)

    const householdSelect = await screen.findByLabelText('Household')
    expect(within(householdSelect).getByRole('option', { name: 'Existing household' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Create another household' }))
    const nameInput = screen.getByLabelText('Household name')
    await user.clear(nameInput)
    await user.type(nameInput, 'HomeCoin Test')
    await user.type(screen.getByLabelText('Your name'), 'Camilo')
    await user.click(screen.getByRole('button', { name: 'Create household' }))

    await waitFor(() => expect(syncMocks.create).toHaveBeenCalledOnce())
    const createdHousehold = syncMocks.create.mock.calls[0][0]
    await waitFor(() => expect((householdSelect as HTMLSelectElement).value).toBe(createdHousehold.id))
    expect(within(householdSelect).getByRole('option', { name: 'Existing household' })).toBeTruthy()
    expect(within(householdSelect).getByRole('option', { name: 'HomeCoin Test' })).toBeTruthy()
    expect(syncMocks.uploadLocalState).not.toHaveBeenCalled()
    expect(onStateChanged).not.toHaveBeenCalled()
  })
})
