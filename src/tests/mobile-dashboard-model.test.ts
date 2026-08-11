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

    expect(model.horizon.map((day) => day.date)).toEqual(['2026-08-11', '2026-08-12', '2026-08-13'])
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

  it('caps the horizon at 14 entries when the window is longer', () => {
    const appState = state(100_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'income', title: 'Wages', amountCents: 50_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-31' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.horizon).toHaveLength(14)
    expect(model.horizon[0].date).toBe('2026-08-11')
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

describe('buildMobileDashboardModel — safe to spend and runway (Act 1)', () => {
  it('computes safe-to-spend as balance minus horizon bills minus prorated savings, never clamped', () => {
    const appState = state(100_000)
    const category = categoryIds(appState)
    appState.goals = [{
      id: 'goal', householdId: appState.household.id, name: 'Holiday', targetCents: 500_000, currentCents: 0,
      monthlyContributionCents: 31_000, priority: 1, notes: '', archived: false,
    }]
    appState.transactions = [
      transaction(appState, { id: 'income', title: 'Wages', amountCents: 50_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-13' }),
      transaction(appState, { id: 'bill', title: 'Rent', amountCents: 70_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-12' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    // horizon: today 2026-08-11 -> next income 2026-08-13, 3 days. Bills in horizon: 70_000.
    // savings: 31_000 * (3 / 30) = 3100 rounded, using the fixed 30-day allocation.
    expect(model.safeToSpendCents).toBe(100_000 - 70_000 - 3_100)
  })

  it('does not clamp a negative safe-to-spend value', () => {
    const appState = state(10_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'bill', title: 'Rent', amountCents: 40_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-12' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.safeToSpendCents).toBeLessThan(0)
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

describe('buildMobileDashboardModel — goals and headline (Act 3)', () => {
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

  it('produces a warning headline with structured values (never pre-formatted money) when a horizon day goes negative', () => {
    const appState = state(50_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'bill', title: 'Rent', amountCents: 70_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-13' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.tone).toBe('warning')
    expect(model.headline.template).toBe('Short by {amount} on {day} — {billTotal} of bills before your next payday.')
    expect(model.headline.values.amount).toBe(20_000)
    expect(model.headline.values.day).toBe('Thu, 13 Aug')
    expect(model.headline.values.billTotal).toBe(70_000)
    expect(model.headline.template).not.toMatch(/[€$]/)
    for (const value of Object.values(model.headline.values)) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true)
      else expect(value).not.toMatch(/[€$]/)
    }
  })

  it('produces a tight headline when safe-to-spend is under 10% of the available balance', () => {
    const appState = state(100_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'bill', title: 'Rent', amountCents: 92_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-15' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.tone).toBe('tight')
    expect(model.headline.template).toBe("{amount} to spend {until}. It's tight but it holds.")
  })

  it('produces a good/debt headline with a payoff date when debt exists and a pace is known', () => {
    const appState = state(200_000)
    const category = categoryIds(appState)
    const card = account({ type: 'credit-card', currentBalanceCents: -30_000 }, appState.household.id)
    appState.accounts.push(card)
    appState.recurringRules = [{
      id: 'card-payment', householdId: appState.household.id, name: 'Card payment', amountCents: 5_000, frequency: 'monthly',
      interval: 1, nextDueDate: '2026-09-01', accountId: card.id, categoryId: category.bill, generateAutomatically: true, reminder: false, active: true,
    }]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.tone).toBe('good')
    expect(model.headline.template).toBe('{amount} to spend {until}. Debt-free by {payoffDate} at this pace.')
    // Display formatting belongs to the component; the model exposes the raw ISO date.
    expect(model.headline.values.payoffDate).toBe('2027-02-11')
  })

  it('produces a good/goal headline when a goal is over 75% funded and there is no debt or shortfall', () => {
    const appState = state(100_000)
    appState.goals = [{
      id: 'goal', householdId: appState.household.id, name: 'Emergency fund', targetCents: 100_000, currentCents: 80_000,
      monthlyContributionCents: 10_000, priority: 1, notes: '', archived: false,
    }]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.tone).toBe('good')
    expect(model.headline.template).toBe('{amount} to spend {until}. {goalName} is {goalPercent}% there.')
    expect(model.headline.values.goalName).toBe('Emergency fund')
    expect(model.headline.values.goalPercent).toBe('80')
  })

  it('falls back to the plain safe-to-spend headline with no debt or goals', () => {
    const model = buildMobileDashboardModel(state(200_000), referenceDate)

    expect(model.tone).toBe('good')
    expect(model.headline.template).toBe('{amount} to spend {until}.')
  })
})
