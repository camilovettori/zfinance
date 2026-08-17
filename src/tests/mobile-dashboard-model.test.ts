import { describe, expect, it } from 'vitest'
import { buildMobileDashboardModel } from '@/app/dashboard/mobile-dashboard-model'
import { createBlankState } from '@/domain/seed'
import type { AppState, FinancialAccount, Transaction } from '@/domain/model'

const referenceDate = new Date(2026, 7, 11, 12, 0, 0) // Tue 11 Aug 2026

function account(overrides: Partial<FinancialAccount>, householdId: string): FinancialAccount {
  return {
    id: crypto.randomUUID(),
    householdId,
    name: 'Current account',
    institution: '',
    type: 'current',
    currency: 'EUR',
    openingBalanceCents: 0,
    currentBalanceCents: 0,
    holder: '',
    accentColor: '#2F7D5B',
    archived: false,
    notes: '',
    ...overrides,
  }
}

function state(balanceCents: number): AppState {
  const state = createBlankState()
  state.settings.currency = 'EUR'
  state.settings.locale = 'en-IE'
  state.settings.weekStartDay = 4
  state.household.currency = 'EUR'
  state.household.locale = 'en-IE'
  state.household.weekStartDay = 4
  state.accounts = [account({ currentBalanceCents: balanceCents, openingBalanceCents: balanceCents }, state.household.id)]
  return state
}

function categoryIds(appState: AppState) {
  const income = appState.categories.find((category) => ['Income', 'Receitas'].includes(category.group))!
  const bill = appState.categories.find((category) => !['Income', 'Receitas', 'Transfers', 'Movimento'].includes(category.group))!
  return { income: income.id, bill: bill.id }
}

function transaction(appState: AppState, values: Partial<Transaction> & Pick<Transaction, 'id' | 'title' | 'amountCents' | 'type' | 'categoryId' | 'transactionDate'>): Transaction {
  return {
    householdId: appState.household.id,
    description: values.title,
    accountId: appState.accounts[0].id,
    dueDate: values.transactionDate,
    status: 'planned',
    tags: [],
    notes: '',
    source: 'manual',
    splits: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...values,
  }
}

describe('buildMobileDashboardModel — horizon (Act 2)', () => {
  it('includes an empty day between two event days', () => {
    const appState = state(100_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'today-bill', title: 'Netflix', amountCents: 2_200, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-11' }),
      transaction(appState, { id: 'later-income', title: 'Wages', amountCents: 50_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-13' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.horizon.slice(0, 3).map((day) => day.date)).toEqual(['2026-08-11', '2026-08-12', '2026-08-13'])
    expect(model.horizon[1].items).toEqual([])
    expect(model.horizon[1].incomeCents).toBe(0)
    expect(model.horizon[1].billsCents).toBe(0)
    expect(model.horizon[1].dayLabel).toBe('Tomorrow')
  })

  it('carries a running balance across days, applying each day in order', () => {
    const appState = state(100_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'bill', title: 'Rent', amountCents: 40_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-12' }),
      transaction(appState, { id: 'income', title: 'Wages', amountCents: 57_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-13' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.horizon[0].balanceAfterCents).toBe(100_000)
    expect(model.horizon[1].balanceAfterCents).toBe(60_000)
    expect(model.horizon[2].balanceAfterCents).toBe(117_000)
  })

  it('flags the lowest-balance day as the low point and any negative day as negative', () => {
    const appState = state(50_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'bill', title: 'Rent', amountCents: 70_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-12' }),
      transaction(appState, { id: 'income', title: 'Wages', amountCents: 90_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-13' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.horizon[1].balanceAfterCents).toBe(-20_000)
    expect(model.horizon[1].isNegative).toBe(true)
    expect(model.horizon[1].isLowPoint).toBe(true)
    expect(model.lowPointCents).toBe(-20_000)
    expect(model.lowPointDateIso).toBe('2026-08-12')
    expect(model.horizon[0].isLowPoint).toBe(false)
    expect(model.horizon[2].isLowPoint).toBe(false)
  })

  it('keeps the dashboard horizon fixed to seven local calendar days', () => {
    const appState = state(100_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'income', title: 'Wages', amountCents: 50_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-31' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.horizon).toHaveLength(7)
    expect(model.horizon[0].date).toBe('2026-08-11')
    expect(model.horizon.at(-1)?.date).toBe('2026-08-17')
  })
})

describe('buildMobileDashboardModel — debt and net worth wiring', () => {
  it('surfaces totalOwedCents, netWorthCents and the full debt summary', () => {
    const appState = state(150_000)
    appState.accounts.push(account({ type: 'credit-card', currentBalanceCents: -40_000 }, appState.household.id))

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.totalOwedCents).toBe(40_000)
    expect(model.netWorthCents).toBe(110_000)
    expect(model.debt.accounts).toHaveLength(1)
    expect(model.debt.totalOwedCents).toBe(40_000)
  })
})

describe('buildMobileDashboardModel — tomorrow balance and runway', () => {
  it('computes After tomorrow from current balance and tomorrow movements only', () => {
    const appState = state(100_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'today-bill', title: 'Today', amountCents: 90_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-11' }),
      transaction(appState, { id: 'tomorrow-income', title: 'Wages', amountCents: 50_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-12' }),
      transaction(appState, { id: 'tomorrow-bill', title: 'Rent', amountCents: 70_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-12' }),
      transaction(appState, { id: 'later-bill', title: 'Later', amountCents: 80_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-13' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.tomorrowIncomingCents).toBe(50_000)
    expect(model.tomorrowDueCents).toBe(70_000)
    expect(model.afterTomorrowCents).toBe(80_000)
  })

  it('keeps a negative After tomorrow balance explicit', () => {
    const appState = state(10_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'bill', title: 'Rent', amountCents: 40_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-12' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.afterTomorrowCents).toBe(-30_000)
  })

  it('reports runwayDays as the first day a 90-day projection goes negative', () => {
    const appState = state(10_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'bill', title: 'Rent', amountCents: 40_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-14' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.runwayIsInfinite).toBe(false)
    expect(model.runwayDays).toBe(3) // 08-11=0, 08-12=1, 08-13=2, 08-14=3 -> first negative day index 3
  })

  it('reports runwayIsInfinite when the balance never goes negative in 90 days', () => {
    const model = buildMobileDashboardModel(state(500_000), referenceDate)

    expect(model.runwayIsInfinite).toBe(true)
    expect(model.runwayDays).toBe(90)
  })
})

describe('buildMobileDashboardModel — goals', () => {
  it('maps goals with percent and monthsToTarget', () => {
    const appState = state(100_000)
    appState.goals = [{
      id: 'goal', householdId: appState.household.id, name: 'Holiday', targetCents: 250_000, currentCents: 68_000,
      monthlyContributionCents: 20_000, priority: 1, notes: '', archived: false, targetDate: '2026-12-01',
    }]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.goals).toHaveLength(1)
    expect(model.goals[0]).toMatchObject({ name: 'Holiday', currentCents: 68_000, targetCents: 250_000, percent: 27, monthsToTarget: 10 })
  })

})
