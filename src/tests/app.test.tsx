import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/app/App'
import { createDemoState } from '@/domain/seed'
import type { AppState } from '@/domain/model'
import { todayIso } from '@/lib/date'
import { setAppStateRepositoryForTests } from '@/persistence'
import { webDatabase } from '@/persistence/web/db'

const fakeSession = {
  user: {
    id: 'homecoin-test-user',
    email: 'test@example.com',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-08-10T00:00:00.000Z',
  },
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expires_in: 3600,
  expires_at: 1_785_321_600,
  token_type: 'bearer',
  provider_token: null,
  provider_refresh_token: null,
} as const

const authMocks = vi.hoisted(() => ({
  session: vi.fn(),
  onAuthStateChange: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  signUp: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
  getSupabaseClient: vi.fn(),
  restoreActiveSyncRuntime: vi.fn(),
  acceptInvite: vi.fn(),
  activateSyncRuntime: vi.fn(),
  uploadLocalState: vi.fn(),
  deactivateSyncRuntime: vi.fn(),
}))

vi.mock('@/auth/auth-service', () => ({
  AuthService: class {
    session = authMocks.session
    onAuthStateChange = authMocks.onAuthStateChange
    signIn = authMocks.signIn
    signOut = authMocks.signOut
    signUp = authMocks.signUp
    requestPasswordReset = authMocks.requestPasswordReset
    updatePassword = authMocks.updatePassword
  },
}))

vi.mock('@/sync', async () => {
  const actual = await vi.importActual<typeof import('@/sync')>('@/sync')
  return {
    ...actual,
    getSupabaseClient: authMocks.getSupabaseClient,
    restoreActiveSyncRuntime: authMocks.restoreActiveSyncRuntime,
    SupabaseHouseholdRepository: class {
      acceptInvite = authMocks.acceptInvite
    },
    activateSyncRuntime: authMocks.activateSyncRuntime,
    activeSyncCoordinator: () => ({ uploadLocalState: authMocks.uploadLocalState }),
    deactivateSyncRuntime: authMocks.deactivateSyncRuntime,
  }
})

const createAugustPlannerState = () => {
  const state = createDemoState()
  state.settings.currency = 'EUR'
  state.settings.locale = 'en-IE'
  state.settings.weekStartDay = 4
  state.household.currency = 'EUR'
  state.household.locale = 'en-IE'
  state.household.weekStartDay = 4
  state.goals = []
  state.recurringRules = []
  state.accounts = [{ ...state.accounts[0], type: 'current', openingBalanceCents: 0, currentBalanceCents: 0 }]
  const incomeCategoryId = state.categories.find((category) => ['Income', 'Receitas'].includes(category.group))!.id
  const expenseCategoryId = state.categories.find((category) => !['Income', 'Receitas', 'Transfers', 'Movimento'].includes(category.group))!.id
  const entries = [
    ['Income 1', '2026-08-06', 'income', 110_000, incomeCategoryId],
    ['Income 2', '2026-08-13', 'income', 110_000, incomeCategoryId],
    ['Income 3', '2026-08-20', 'income', 110_000, incomeCategoryId],
    ['Income 4', '2026-08-27', 'income', 110_000, incomeCategoryId],
    ['August household bills', '2026-08-20', 'expense', 326_328, expenseCategoryId],
    ['August final bills', '2026-08-28', 'expense', 79_383, expenseCategoryId],
    ['Camilo Car Insurance', '2026-09-01', 'expense', 6_315, expenseCategoryId],
    ['CC Brasil', '2026-09-01', 'expense', 22_500, expenseCategoryId],
    ['Royal London - Life Insurance', '2026-09-02', 'expense', 3_925, expenseCategoryId],
  ] as const
  state.transactions = entries.map(([title, date, type, amountCents, categoryId], index) => ({
    id: `planner-scenario-${index}`,
    householdId: state.household.id,
    title,
    description: title,
    amountCents,
    type,
    categoryId,
    accountId: state.accounts[0].id,
    transactionDate: date,
    dueDate: date,
    status: 'planned',
    tags: [],
    notes: '',
    source: 'manual',
    splits: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }))
  return state
}

const createCarryRegressionState = () => {
  const state = createDemoState()
  state.settings.currency = 'EUR'
  state.settings.locale = 'en-IE'
  state.settings.weekStartDay = 4
  state.household.currency = 'EUR'
  state.household.locale = 'en-IE'
  state.household.weekStartDay = 4
  state.goals = []
  state.recurringRules = []
  state.accounts = [{ ...state.accounts[0], type: 'current', openingBalanceCents: 8_212, currentBalanceCents: 8_212 }]
  const incomeCategoryId = state.categories.find((category) => ['Income', 'Receitas'].includes(category.group))!.id
  const expenseCategoryId = state.categories.find((category) => !['Income', 'Receitas', 'Transfers', 'Movimento'].includes(category.group))!.id
  const entries = [
    ['August carry income', '2026-08-27', 'income', 110_070, incomeCategoryId],
    ['August carry bills', '2026-08-28', 'expense', 108_677, expenseCategoryId],
    ['September carry income', '2026-09-03', 'income', 110_070, incomeCategoryId],
    ['September carry bills', '2026-09-04', 'expense', 74_024, expenseCategoryId],
  ] as const
  state.transactions = entries.map(([title, date, type, amountCents, categoryId], index) => ({
    id: `carry-scenario-${index}`,
    householdId: state.household.id,
    title,
    description: title,
    amountCents,
    type,
    categoryId,
    accountId: state.accounts[0].id,
    transactionDate: date,
    dueDate: date,
    status: 'planned',
    tags: [],
    notes: '',
    source: 'manual',
    splits: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }))
  return state
}

const setViewport = (width: number) => {
  vi.mocked(window.matchMedia).mockImplementation((query) => {
    const max = query.match(/max-width:\s*(\d+)px/)
    const min = query.match(/min-width:\s*(\d+)px/)
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1])) && !query.includes('display-mode: standalone')
    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }
  })
}

describe('HomeCoin app shell', () => {
  beforeEach(() => {
    setViewport(1440)
    window.localStorage.setItem('homecoin:web-state', JSON.stringify(createDemoState()))
    authMocks.session.mockReset().mockResolvedValue(fakeSession)
    authMocks.onAuthStateChange.mockReset().mockReturnValue(() => undefined)
    authMocks.signIn.mockReset()
    authMocks.signOut.mockReset()
    authMocks.signUp.mockReset()
    authMocks.requestPasswordReset.mockReset()
    authMocks.updatePassword.mockReset()
    authMocks.getSupabaseClient.mockReset().mockReturnValue(null)
    authMocks.restoreActiveSyncRuntime.mockReset().mockResolvedValue(null)
    authMocks.acceptInvite.mockReset()
    authMocks.activateSyncRuntime.mockReset()
    authMocks.uploadLocalState.mockReset()
    authMocks.deactivateSyncRuntime.mockReset()
  })

  afterEach(() => {
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  })

  it('uses a small-screen onboarding wizard that preserves answers when going back', async () => {
    setViewport(390)
    window.localStorage.clear()
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Which currency do you use?' })).toBeTruthy()
    expect(screen.queryByLabelText('First day of the week')).toBeNull()
    await user.selectOptions(screen.getByLabelText('Currency'), 'EUR')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: 'When does your financial week begin?' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect((screen.getByLabelText('Currency') as HTMLSelectElement).value).toBe('EUR')
  })

  it('shows the web/PWA auth gate when sync is enabled and no session is available', async () => {
    authMocks.session.mockResolvedValueOnce(null)
    const { container } = render(<App />)

    expect(await screen.findByRole('heading', { name: 'Sign in to continue' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeTruthy()
    expect(container.querySelector('.sync-panel')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /^Good (morning|afternoon|evening), / })).toBeNull()
  })

  it('preserves an invitation through login and opens its remote household before onboarding', async () => {
    const user = userEvent.setup()
    const token = 'a'.repeat(43)
    let authChanged: ((event: string, session: typeof fakeSession | null) => void) | undefined
    window.history.replaceState({}, '', `/?invite=${token}&source=email#join`)
    window.localStorage.clear()
    authMocks.getSupabaseClient.mockReturnValue({})
    authMocks.session.mockResolvedValueOnce(null)
    authMocks.onAuthStateChange.mockImplementation((callback) => {
      authChanged = callback
      return () => undefined
    })

    const remoteSnapshot = createDemoState()
    remoteSnapshot.household = { ...remoteSnapshot.household, id: 'invited-household', name: 'Invited household' }
    remoteSnapshot.accounts = remoteSnapshot.accounts.map((account) => ({ ...account, householdId: remoteSnapshot.household.id }))
    remoteSnapshot.categories = remoteSnapshot.categories.map((category) => ({ ...category, householdId: remoteSnapshot.household.id }))
    remoteSnapshot.transactions = remoteSnapshot.transactions.map((transaction) => ({ ...transaction, householdId: remoteSnapshot.household.id }))
    remoteSnapshot.recurringRules = remoteSnapshot.recurringRules.map((rule) => ({ ...rule, householdId: remoteSnapshot.household.id }))
    const joined = {
      household: remoteSnapshot.household,
      membership: { id: 'invited-member', householdId: remoteSnapshot.household.id, name: 'Member', role: 'member', color: '#2F7D5B', active: true },
    }
    remoteSnapshot.members = [joined.membership]
    authMocks.acceptInvite.mockResolvedValue(joined)
    authMocks.activateSyncRuntime.mockResolvedValue({ isReady: vi.fn().mockResolvedValue(true) })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Sign in to continue' })).toBeTruthy()
    expect(window.location.search).toContain(`invite=${token}`)
    expect(screen.queryByRole('heading', { name: "Let's set up your household plan" })).toBeNull()
    expect(authMocks.restoreActiveSyncRuntime).not.toHaveBeenCalled()

    await act(async () => authChanged?.('SIGNED_IN', fakeSession))
    expect(await screen.findByRole('heading', { name: 'Accept invitation' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: "Let's set up your household plan" })).toBeNull()
    expect(window.location.search).toContain(`invite=${token}`)

    await webDatabase.appState.put({
      id: `household:${remoteSnapshot.household.id}`,
      schemaVersion: remoteSnapshot.schemaVersion,
      payload: remoteSnapshot,
      updatedAt: new Date().toISOString(),
    })
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }))

    expect(await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening), / })).toBeTruthy()
    expect(authMocks.acceptInvite).toHaveBeenCalledWith(token)
    expect(authMocks.activateSyncRuntime).toHaveBeenCalledWith({}, remoteSnapshot.household.id, { openRemoteIfNeeded: true })
    expect(authMocks.uploadLocalState).not.toHaveBeenCalled()
    expect(new URL(window.location.href).searchParams.get('invite')).toBeNull()
    expect(new URL(window.location.href).searchParams.get('source')).toBe('email')
    expect(window.location.hash).toBe('#join')
  })

  it('restores the active sync runtime after login without opening Settings', async () => {
    authMocks.getSupabaseClient.mockReturnValue({})
    render(<App />)

    await waitFor(() => expect(authMocks.restoreActiveSyncRuntime).toHaveBeenCalledOnce())
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull()
  })

  it('keeps Tauri local-only without restoring a cloud runtime', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    window.history.replaceState({}, '', `/?invite=${'c'.repeat(43)}`)
    const desktopState = createDemoState()
    setAppStateRepositoryForTests({
      load: async () => desktopState,
      save: async (next) => next,
      clear: async () => undefined,
      getMetadata: async () => ({ source: 'sqlite', schemaVersion: desktopState.schemaVersion, updatedAt: null, migratedFromLocalStorage: false }),
    })
    authMocks.getSupabaseClient.mockReturnValue({})
    render(<App />)

    await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening), Our Home$/ })
    expect(authMocks.restoreActiveSyncRuntime).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Accept invitation' })).toBeNull()
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  })

  it('opens the dashboard and navigates to savings', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening), Our Home$/ })).toBeTruthy()
    expect(screen.getByText('This week after bills')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Cash flow' })).toBeTruthy()

    await user.click(screen.getAllByRole('button', { name: /^Savings$/ })[0])

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Savings goals' })).toBeTruthy()
      expect(screen.getByText('Emergency fund')).toBeTruthy()
      expect(screen.getByText('Vacation')).toBeTruthy()
    })
  })

  it('uses simplified bottom navigation on mobile and keeps Savings and Settings inside More', async () => {
    setViewport(390)
    const user = userEvent.setup()
    const { container } = render(<App />)
    await screen.findByRole('heading', { name: /^Good / })

    expect(container.querySelector('.app-sidebar')).toBeNull()
    const navigation = screen.getByRole('navigation', { name: 'Mobile navigation' })
    expect(within(navigation).getAllByRole('button')).toHaveLength(4)
    expect(within(navigation).getByRole('button', { name: 'Planner' })).toBeTruthy()
    expect(within(navigation).queryByRole('button', { name: 'Bills' })).toBeNull()
    await user.click(within(navigation).getByRole('button', { name: 'More sections' }))
    expect(screen.queryByRole('button', { name: 'This Week' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'This Month' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Recurring' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Savings' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy()
  })

  it('renders the desktop sidebar and preserves the seven-column Planner', async () => {
    setViewport(1440)
    const user = userEvent.setup()
    const { container } = render(<App />)
    await screen.findByRole('heading', { name: /^Good / })
    expect(container.querySelector('.app-sidebar')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Mobile navigation' })).toBeNull()
    const navigation = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(navigation).getAllByRole('button').map((button) => button.textContent)).toEqual(['Dashboard', 'Planner', 'Savings', 'Reports', 'Settings'])
    await user.click(screen.getByRole('button', { name: 'Planner' }))
    expect(await screen.findByRole('heading', { name: / Planner$/ })).toBeTruthy()
    expect(container.querySelector('.planning-day-grid')?.children).toHaveLength(7)
  })

  it('uses mobile Week, Day, and Month overview modes with an Add bottom sheet', async () => {
    setViewport(390)
    window.localStorage.setItem('homecoin:web-state', JSON.stringify(createAugustPlannerState()))
    const user = userEvent.setup()
    const { container } = render(<App />)
    await screen.findByRole('heading', { name: /^Good / })
    await user.click(screen.getByRole('button', { name: 'Planner' }))

    expect(await screen.findByRole('region', { name: 'Mobile financial planner' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Week' }).getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('.planning-day-grid')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Next planner week' }))
    await user.click(container.querySelector('.mobile-week-day[data-date="2026-08-06"]') as HTMLElement)
    expect(screen.getByRole('tab', { name: 'Day' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: 'Add income' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add bill' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Add bill' }))
    expect(await screen.findByRole('heading', { name: 'Add item' })).toBeTruthy()
    expect(container.querySelector('.modal-panel')).toBeTruthy()
    expect((screen.getByLabelText('Due date') as HTMLInputElement).value).toBe('2026-08-06')
  }, 20_000)

  it('offers Move to date without touch drag and keeps the cycle closing identical on mobile', async () => {
    setViewport(430)
    window.localStorage.setItem('homecoin:web-state', JSON.stringify(createAugustPlannerState()))
    const user = userEvent.setup()
    const { container } = render(<App />)
    await screen.findByRole('heading', { name: /^Good / })
    await user.click(screen.getByRole('button', { name: 'Planner' }))
    expect(await screen.findAllByText('€15.49')).not.toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Next planner week' }))
    await user.click(container.querySelector('.mobile-week-day[data-date="2026-08-06"]') as HTMLElement)
    await user.click(screen.getByRole('button', { name: /Move Income 1 to another date/ }))
    expect(await screen.findByRole('heading', { name: 'Move occurrence' })).toBeTruthy()
  }, 20_000)

  it('renders Bills as mobile disclosure cards without a horizontal table', async () => {
    setViewport(390)
    const { container } = render(<App />)
    await screen.findByRole('heading', { name: /^Good / })
    fireEvent.keyDown(document.body, { key: 'g' })
    fireEvent.keyDown(document.body, { key: 'b' })
    expect(await screen.findByRole('heading', { name: 'Bills' })).toBeTruthy()
    expect(container.querySelector('.data-table.mobile-card-table')).toBeTruthy()
    expect(container.querySelector('td[data-label="Due date"]')).toBeTruthy()
  })

  it('supports keyboard navigation shortcuts with visible section changes', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: /^Good / })
    fireEvent.keyDown(document.body, { key: 'g' })
    fireEvent.keyDown(document.body, { key: 'p' })
    expect(await screen.findByRole('heading', { name: 'Planner' })).toBeTruthy()
  })

  it('shows printable weekly and monthly planning grids', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await screen.findByRole('heading', { name: /^Good / })
    await user.click(screen.getAllByRole('button', { name: /^Reports$/ })[0])

    expect(await screen.findByRole('heading', { name: 'Printable household planning' })).toBeTruthy()
    expect(container.querySelectorAll('.planning-week')).toHaveLength(1)
    expect(container.querySelectorAll('.planning-day')).toHaveLength(7)
    expect(screen.getAllByText('Savings accumulated').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Monthly planner' }))
    await waitFor(() => {
      const weeks = container.querySelectorAll('.planning-week')
      expect(weeks.length).toBeGreaterThanOrEqual(4)
      expect(weeks.length).toBeLessThanOrEqual(6)
      expect(container.querySelectorAll('.planning-day')).toHaveLength(weeks.length * 7)
    })
    expect(screen.getByRole('heading', { name: 'Monthly grand summary' })).toBeTruthy()
    expect(screen.getAllByText('Income minus bills').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Calendar month income').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Calendar month expenses').length).toBeGreaterThan(0)
    expect(screen.getByText('Adjacent days are shown to complete each week and calculate the balance correctly.')).toBeTruthy()
    expect(container.querySelectorAll('.planning-day.outside-report-period').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.planning-day.outside-report-period footer').length).toBe(
      container.querySelectorAll('.planning-day.outside-report-period').length,
    )
  }, 20_000)

  it('opens the interactive Planner and prefills Add with the selected day', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await screen.findByRole('heading', { name: /^Good / })
    await user.click(screen.getAllByRole('button', { name: /^Planner$/ })[0])

    expect(await screen.findByRole('heading', { name: 'Planner' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: / Planner$/ })).toBeTruthy()
    expect(container.querySelectorAll('.planning-week').length).toBeGreaterThanOrEqual(4)
    expect(container.querySelectorAll('.planning-day').length % 7).toBe(0)
    expect(screen.getAllByText('Planner cycle summary').length).toBeGreaterThan(0)

    const addForDay = screen.getAllByRole('button', { name: /^Add item on / })[0]
    const selectedDate = addForDay.getAttribute('aria-label')!.replace('Add item on ', '')
    await user.click(addForDay)
    expect(await screen.findByRole('heading', { name: 'Add item' })).toBeTruthy()
    expect((screen.getByLabelText('Due date') as HTMLInputElement).value).toBe(selectedDate)
  }, 20_000)

  it('shows only the strict August planner-cycle result, then advances to 3 September', async () => {
    window.localStorage.setItem('homecoin:web-state', JSON.stringify(createAugustPlannerState()))
    const user = userEvent.setup()
    const { container } = render(<App />)
    await screen.findByRole('heading', { name: /^Good / })
    await user.click(screen.getAllByRole('button', { name: /^Planner$/ })[0])

    const summary = await waitFor(() => container.querySelector('.monthly-grand-summary')!)
    expect(within(summary as HTMLElement).getByText('Planner cycle summary')).toBeTruthy()
    expect(within(summary as HTMLElement).queryByText('Calendar month result')).toBeNull()
    expect(within(summary as HTMLElement).getByText('Total cycle income')).toBeTruthy()
    expect(within(summary as HTMLElement).getByText('Total cycle bills')).toBeTruthy()
    expect(within(summary as HTMLElement).getByText('Cycle closing balance')).toBeTruthy()
    expect(within(summary as HTMLElement).getAllByText('€4,400.00').length).toBeGreaterThan(0)
    expect(within(summary as HTMLElement).getAllByText('€4,384.51').length).toBeGreaterThan(0)
    expect(within(summary as HTMLElement).getAllByText('€15.49').length).toBeGreaterThan(0)
    expect(within(summary as HTMLElement).queryByText('€342.89')).toBeNull()
    expect(within(summary as HTMLElement).queryByText('€552.35')).toBeNull()

    const periods = container.querySelector('.planner-periods')!
    expect(within(periods as HTMLElement).queryByText('Calendar month')).toBeNull()
    expect(within(periods as HTMLElement).getByText('30 Jul–2 Sept')).toBeTruthy()
    expect(within(periods as HTMLElement).getByText('3 Sept')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Next →' }))
    await waitFor(() => expect(container.querySelector('.planning-day[data-date="2026-09-03"]')).toBeTruthy())
    expect(container.querySelector('.planning-day[data-date="2026-09-01"]')).toBeNull()
    expect(container.querySelector('.planning-day[data-date="2026-09-02"]')).toBeNull()
    expect(within(container.querySelector('.planner-periods') as HTMLElement).getByText('3–30 Sept')).toBeTruthy()
  }, 20_000)

  it('carries the August closing into September opening on the real Planner screen', async () => {
    window.localStorage.setItem('homecoin:web-state', JSON.stringify(createCarryRegressionState()))
    const user = userEvent.setup()
    const { container } = render(<App />)
    await screen.findByRole('heading', { name: /^Good / })
    await user.click(screen.getAllByRole('button', { name: /^Planner$/ })[0])

    const augustSummary = await waitFor(() => container.querySelector('.monthly-grand-summary')!)
    expect(within(augustSummary as HTMLElement).getAllByText('€96.05')).toHaveLength(2)
    expect(within(augustSummary as HTMLElement).queryByText('€456.51')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Next →' }))
    const septemberWeek = await waitFor(() => container.querySelector('.planning-week')!)
    expect(septemberWeek.querySelector('.planning-week-heading span')?.textContent).toBe('€96.05 opening → €456.51 closing')
    expect(septemberWeek.textContent).toContain('€456.51')
  }, 20_000)

  it('shows a running weekly balance that carries into future weeks', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: /^Good / })
    fireEvent.keyDown(document.body, { key: 'g' })
    fireEvent.keyDown(document.body, { key: 'w' })

    expect(await screen.findByText('Opening balance')).toBeTruthy()
    expect(screen.getByText('Projected closing balance')).toBeTruthy()
    expect(screen.getAllByText('Running balance')).toHaveLength(7)
    expect(screen.getAllByText(/^Projected closing:/).length).toBeGreaterThanOrEqual(4)
  })

  it('deletes and restores a bill, including bulk selection', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: /^Good / })
    fireEvent.keyDown(document.body, { key: 'g' })
    fireEvent.keyDown(document.body, { key: 'b' })
    await screen.findByRole('heading', { name: 'Bills' })

    await user.click((await screen.findAllByTitle('Delete bill'))[0])
    expect(screen.getByRole('heading', { name: 'Delete this bill?' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^Delete$/ }))
    expect(await screen.findByText('Bill deleted')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Bill restored')).toBeTruthy()

    await user.click(screen.getByRole('checkbox', { name: 'Select all bills' }))
    await user.click(screen.getByRole('button', { name: /Delete selected/ }))
    expect(screen.getByRole('heading', { name: /Delete \d+ bills\?/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^Delete$/ }))
    expect(await screen.findByText(/bills deleted/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Bills restored')).toBeTruthy()
  }, 20_000)

  it('deletes and restores recurring incomes and expenses', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: /^Good / })
    fireEvent.keyDown(document.body, { key: 'g' })
    fireEvent.keyDown(document.body, { key: 'r' })
    await screen.findByRole('heading', { name: 'Recurring income & expenses' })

    await user.click((await screen.findAllByTitle('Delete recurring item'))[0])
    expect(screen.getByText(/stop all future planned occurrences/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^Delete$/ }))
    expect(await screen.findByText('Recurring item deleted')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Recurring item restored')).toBeTruthy()

    await user.click(screen.getByRole('tab', { name: 'Expenses' }))
    await user.click((await screen.findAllByTitle('Delete recurring item'))[0])
    await user.click(screen.getByRole('button', { name: /^Delete$/ }))
    expect(await screen.findByText('Recurring item deleted')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Recurring item restored')).toBeTruthy()
  })

  it('creates either a one-time bill or a recurring rule, never both', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: /^Good / })
    fireEvent.keyDown(document.body, { key: 'g' })
    fireEvent.keyDown(document.body, { key: 'b' })
    await screen.findByRole('heading', { name: 'Bills' })

    await user.click(screen.getByRole('button', { name: /Add bill/ }))
    await user.click(screen.getByRole('button', { name: /^Bill Rent/ }))
    const oneOffName = 'Unique one-time bill'
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: oneOffName } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '83.25' } })
    expect(screen.getByRole('button', { name: /One-time bill/ }).getAttribute('data-active')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Bill added')

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem('homecoin:web-state') ?? '{}') as AppState
      const matches = saved.transactions.filter((transaction) => transaction.title === oneOffName)
      expect(matches).toHaveLength(1)
      expect(matches[0].amountCents).toBe(8_325)
      expect(saved.recurringRules.filter((rule) => rule.name === oneOffName)).toHaveLength(0)
    })

    await user.click(screen.getByRole('button', { name: /Add bill/ }))
    await user.click(screen.getByRole('button', { name: /^Bill Rent/ }))
    const recurringName = 'Unique recurring bill'
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: recurringName } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '42.50' } })
    await user.click(screen.getByRole('button', { name: /Recurring bill/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Recurring bill added')

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem('homecoin:web-state') ?? '{}') as AppState
      expect(saved.transactions.filter((transaction) => transaction.title === recurringName)).toHaveLength(0)
      const matches = saved.recurringRules.filter((rule) => rule.name === recurringName)
      expect(matches).toHaveLength(1)
      expect(matches[0].amountCents).toBe(4_250)
    })
  }, 30_000)

  it('edits one recurring occurrence or the entire future series', async () => {
    const seeded = createDemoState()
    const template = seeded.recurringRules.find((rule) => {
      const category = seeded.categories.find((entry) => entry.id === rule.categoryId)
      return !['Income', 'Receitas'].includes(category?.group ?? '')
    })!
    const originalCategory = seeded.categories.find((category) => category.id === template.categoryId)!
    const alternateCategory = seeded.categories.find((category) =>
      !category.archived &&
      category.id !== originalCategory.id &&
      !['Income', 'Receitas', 'Transfers', 'Movimento'].includes(category.group),
    )!
    const ruleId = 'editable-recurring-bill'
    seeded.recurringRules.unshift({
      ...template,
      id: ruleId,
      name: 'Editable mobile bill',
      amountCents: 3_799,
      nextDueDate: todayIso(),
    })
    window.localStorage.setItem('homecoin:web-state', JSON.stringify(seeded))

    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: /^Good / })
    fireEvent.keyDown(document.body, { key: 'g' })
    fireEvent.keyDown(document.body, { key: 'b' })

    const firstRow = (await screen.findAllByText('Editable mobile bill'))[0].closest('tr')!
    await user.click(within(firstRow).getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('heading', { name: 'Edit item' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /This occurrence only/ }).getAttribute('data-active')).toBe('true')
    const category = screen.getByRole('combobox', { name: 'Category' })
    expect(category.closest('details')).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '39.99' } })
    fireEvent.change(category, { target: { value: alternateCategory.id } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Occurrence updated')

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem('homecoin:web-state') ?? '{}') as AppState
      const override = saved.transactions.find((transaction) => transaction.recurrenceRuleId === ruleId)
      expect(override?.amountCents).toBe(3_999)
      expect(override?.categoryId).toBe(alternateCategory.id)
      expect(saved.recurringRules.find((rule) => rule.id === ruleId)?.amountCents).toBe(3_799)
    })

    const updatedRow = (await screen.findAllByText('Editable mobile bill'))[0].closest('tr')!
    await user.click(within(updatedRow).getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: /Entire recurring series/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Updated mobile series' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '41,25' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Recurring series updated')

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem('homecoin:web-state') ?? '{}') as AppState
      const updatedRule = saved.recurringRules.find((rule) => rule.id === ruleId)
      expect(updatedRule?.name).toBe('Updated mobile series')
      expect(updatedRule?.amountCents).toBe(4_125)
      expect(saved.transactions.some((transaction) => transaction.recurrenceRuleId === ruleId)).toBe(false)
    })
  }, 30_000)
})
