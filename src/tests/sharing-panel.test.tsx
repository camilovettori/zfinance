import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SharingPanel } from '@/components/sync/SharingPanel'
import { createBlankState, createDemoState } from '@/domain/seed'

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
  loadHouseholdState: vi.fn(),
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

vi.mock('@/services/storage', async () => {
  const actual = await vi.importActual<typeof import('@/services/storage')>('@/services/storage')
  return {
    ...actual,
    loadHouseholdState: syncMocks.loadHouseholdState,
  }
})

describe('SharingPanel household creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMocks.session.mockResolvedValue({ user: { email: 'owner@example.com' } })
    authMocks.onAuthStateChange.mockReturnValue(() => undefined)
    syncMocks.members.mockResolvedValue([])
    syncMocks.activateSyncRuntime.mockResolvedValue({ isReady: vi.fn().mockResolvedValue(false) })
    syncMocks.loadHouseholdState.mockResolvedValue(null)
  })

  afterEach(() => {
    window.history.replaceState({}, '', '/')
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

  it('accepts and opens an invited household without uploading local data', async () => {
    const user = userEvent.setup()
    const state = createBlankState()
    const joined = {
      household: { ...state.household, id: 'invited-household', name: 'Invited household' },
      membership: { id: 'invited-member', householdId: 'invited-household', name: 'Member', role: 'member', color: '#2F7D5B', active: true },
    }
    const remoteBase = createDemoState()
    const remoteSnapshot = {
      ...remoteBase,
      onboardingCompleted: true,
      household: joined.household,
      members: [joined.membership],
      accounts: remoteBase.accounts.map((account) => ({ ...account, householdId: joined.household.id })),
    }
    const coordinator = { isReady: vi.fn().mockResolvedValue(true) }
    syncMocks.acceptInvite.mockResolvedValue(joined)
    syncMocks.activateSyncRuntime.mockResolvedValue(coordinator)
    syncMocks.loadHouseholdState.mockResolvedValue(remoteSnapshot)
    const onStateChanged = vi.fn()
    const onInviteAccepted = vi.fn()

    render(<SharingPanel
      inviteOnly
      initialInviteToken={'a'.repeat(43)}
      state={state}
      onStateChanged={onStateChanged}
      onInviteAccepted={onInviteAccepted}
    />)

    await screen.findByText('Join with an invitation')
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }))

    await waitFor(() => expect(onInviteAccepted).toHaveBeenCalledWith(joined))
    expect(syncMocks.acceptInvite).toHaveBeenCalledWith('a'.repeat(43))
    expect(syncMocks.activateSyncRuntime).toHaveBeenCalledWith({}, joined.household.id, { openRemoteIfNeeded: true })
    expect(coordinator.isReady).toHaveBeenCalledOnce()
    expect(syncMocks.loadHouseholdState).toHaveBeenCalledWith(joined.household.id)
    expect(onStateChanged).toHaveBeenCalledWith(remoteSnapshot)
    expect(syncMocks.uploadLocalState).not.toHaveBeenCalled()
  })

  it('keeps the invitation pending and retries only the remote open when loading fails', async () => {
    const user = userEvent.setup()
    const state = createBlankState()
    const joined = {
      household: { ...state.household, id: 'invited-household', name: 'Invited household' },
      membership: { id: 'invited-member', householdId: 'invited-household', name: 'Member', role: 'member', color: '#2F7D5B', active: true },
    }
    syncMocks.acceptInvite.mockResolvedValue(joined)
    syncMocks.activateSyncRuntime.mockResolvedValue({ isReady: vi.fn().mockResolvedValue(false) })
    const onInviteAccepted = vi.fn()
    window.history.replaceState({}, '', `/?invite=${'b'.repeat(43)}`)

    render(<SharingPanel
      inviteOnly
      initialInviteToken={'b'.repeat(43)}
      state={state}
      onStateChanged={vi.fn()}
      onInviteAccepted={onInviteAccepted}
    />)

    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }))
    expect((await screen.findByRole('alert')).textContent).toContain('The shared household could not be loaded')
    expect(window.location.search).toContain('invite=')
    expect(onInviteAccepted).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Accept invitation' }))
    await waitFor(() => expect(syncMocks.activateSyncRuntime).toHaveBeenCalledTimes(2))
    expect(syncMocks.acceptInvite).toHaveBeenCalledOnce()
    expect(syncMocks.uploadLocalState).not.toHaveBeenCalled()
  })
})
