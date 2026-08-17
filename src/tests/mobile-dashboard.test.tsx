import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileDashboard } from '@/app/dashboard/MobileDashboard'
import { buildMobileDashboardModel } from '@/app/dashboard/mobile-dashboard-model'
import { createBlankState } from '@/domain/seed'
import type { AppState, RecurringRule, Transaction } from '@/domain/model'

const referenceDate = new Date(2026, 7, 11, 12, 0, 0)
const createdAt = '2026-08-01T09:00:00.000Z'

function dashboardState(balanceCents = 100_000) {
  const state = createBlankState()
  state.onboardingCompleted = true
  state.household.name = 'HomeCoin Test'
  state.household.currency = 'EUR'
  state.household.locale = 'en-IE'
  state.household.weekStartDay = 4
  state.settings.currency = 'EUR'
  state.settings.locale = 'en-IE'
  state.settings.weekStartDay = 4
  state.accounts = [{
    id: 'account-current', householdId: state.household.id, name: 'Current account', institution: '', type: 'current', currency: 'EUR',
    openingBalanceCents: balanceCents, currentBalanceCents: balanceCents, holder: '', accentColor: '#2F7D5B', archived: false, notes: '',
  }]
  state.transactions = []
  state.recurringRules = []
  state.goals = []
  return state
}

function categoryIds(state: AppState) {
  const income = state.categories.find((category) => ['Income', 'Receitas'].includes(category.group))!
  const bill = state.categories.find((category) => !['Income', 'Receitas', 'Transfers', 'Movimento'].includes(category.group))!
  return { income: income.id, bill: bill.id }
}

function transaction(state: AppState, values: Partial<Transaction> & Pick<Transaction, 'id' | 'title' | 'amountCents' | 'type' | 'categoryId' | 'transactionDate'>): Transaction {
  return {
    householdId: state.household.id,
    description: values.title,
    accountId: state.accounts[0].id,
    dueDate: values.transactionDate,
    status: 'planned',
    tags: [],
    notes: '',
    source: 'manual',
    splits: [],
    createdAt,
    updatedAt: createdAt,
    ...values,
  }
}

function recurringRule(state: AppState, values: Pick<RecurringRule, 'id' | 'name' | 'amountCents' | 'nextDueDate' | 'categoryId'>): RecurringRule {
  return {
    ...values,
    householdId: state.household.id,
    frequency: 'weekly',
    interval: 1,
    accountId: state.accounts[0].id,
    generateAutomatically: true,
    reminder: true,
    active: true,
  }
}

describe('mobile dashboard model', () => {
  it('renders Available now and After tomorrow without removed hero language', () => {
    const state = dashboardState()
    const category = categoryIds(state)
    state.transactions = [transaction(state, {
      id: 'income', title: 'Payday', amountCents: 50_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-13',
    })]

    render(<MobileDashboard state={state} referenceDate={referenceDate} onEditItem={vi.fn()} onAddIncome={vi.fn()} onAddBill={vi.fn()} />)

    expect(screen.getByText('Available now')).not.toBeNull()
    expect(screen.getByText('After tomorrow')).not.toBeNull()
    expect(screen.queryByText(/Safe to spend/i)).toBeNull()
    expect(screen.queryByText(/Committed first/i)).toBeNull()
    expect(screen.queryByText(/Then income/i)).toBeNull()
  })

  it('renders tomorrow, after-tomorrow balance, and grouped next income', () => {
    const state = dashboardState()
    const category = categoryIds(state)
    state.goals = [{
      id: 'goal', householdId: state.household.id, name: 'Buffer', targetCents: 300_000, currentCents: 0,
      monthlyContributionCents: 30_000, priority: 1, notes: '', archived: false,
    }]
    state.transactions = [
      transaction(state, { id: 'income-a', title: 'Iris Wages', amountCents: 57_070, type: 'income', categoryId: category.income, transactionDate: '2026-08-12' }),
      transaction(state, { id: 'income-b', title: 'Partner Wages', amountCents: 53_552, type: 'income', categoryId: category.income, transactionDate: '2026-08-12' }),
      transaction(state, { id: 'bill-a', title: 'Electricity', amountCents: 40_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-12' }),
    ]

    const model = buildMobileDashboardModel(state, referenceDate)
    expect(model.horizon.find((event) => event.date === '2026-08-12')?.items.map((item) => item.title))
      .toEqual(['Iris Wages', 'Partner Wages', 'Electricity'])
    expect(model.nextIncome?.items).toHaveLength(2)
    expect(model.nextIncome?.totalCents).toBe(110_622)
    expect(model.afterTomorrowCents).toBe(170_622)
  })

  it('shows a calm empty state when nothing is due tomorrow and no income is scheduled', () => {
    const model = buildMobileDashboardModel(dashboardState(), referenceDate)
    expect(model.horizon).toHaveLength(7)
    expect(model.horizon.every((event) => event.items.length === 0)).toBe(true)
    expect(model.nextIncome).toBeNull()
  })

  it('keeps negative balances explicit', () => {
    const state = dashboardState(-10_000)
    const category = categoryIds(state)
    state.transactions = [transaction(state, {
      id: 'bill-negative', title: 'Rent', amountCents: 20_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-12',
    })]

    const model = buildMobileDashboardModel(state, referenceDate)
    expect(model.afterTomorrowCents).toBe(-30_000)
  })

  it('uses virtual recurrences without materializing transactions', () => {
    const state = dashboardState()
    const category = categoryIds(state)
    state.recurringRules = [recurringRule(state, {
      id: 'weekly-income', name: 'Recurring wages', amountCents: 57_070, nextDueDate: '2026-08-12', categoryId: category.income,
    })]

    const model = buildMobileDashboardModel(state, referenceDate)
    expect(model.horizon[1].items).toHaveLength(1)
    expect(model.horizon[1].items[0]).toMatchObject({ title: 'Recurring wages', sourceKind: 'recurring' })
    expect(state.transactions).toHaveLength(0)
  })

  it('does not show a paid recurring occurrence as due again', () => {
    const state = dashboardState()
    const category = categoryIds(state)
    state.recurringRules = [recurringRule(state, {
      id: 'weekly-bill', name: 'Recurring bill', amountCents: 25_000, nextDueDate: '2026-08-12', categoryId: category.bill,
    })]
    state.transactions = [transaction(state, {
      id: 'paid-occurrence', title: 'Recurring bill', amountCents: 25_000, type: 'expense', categoryId: category.bill,
      transactionDate: '2026-08-12', dueDate: '2026-08-12', paidDate: '2026-08-12', status: 'paid', recurrenceRuleId: 'weekly-bill',
    })]

    const model = buildMobileDashboardModel(state, referenceDate)
    expect(model.horizon.flatMap((event) => event.items)).toEqual([])
    expect(model.afterTomorrowCents).toBe(100_000)
  })

  it('uses the exact Planner week for Thursday–Wednesday opening, flows, savings, and closing', () => {
    const model = buildMobileDashboardModel(dashboardState(82_120), referenceDate)
    expect(model.currentWeek.start).toBe('2026-08-06')
    expect(model.currentWeek.end).toBe('2026-08-12')
    expect(model.currentWeek).toMatchObject({
      openingBalanceCents: 82_120,
      incomeCents: 0,
      expenseCents: 0,
      plannedSavingsCents: 0,
      closingBalanceCents: 82_120,
    })
  })

  it('horizon includes empty days between events', () => {
    const state = dashboardState()
    const category = categoryIds(state)
    state.transactions = [
      transaction(state, { id: 'bill', title: 'Bill', amountCents: 10_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-12' }),
      transaction(state, { id: 'income', title: 'Income', amountCents: 50_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-14' }),
    ]

    const model = buildMobileDashboardModel(state, referenceDate)
    expect(model.horizon.slice(0, 4).map((event) => event.date)).toEqual(['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'])
    expect(model.horizon.find((event) => event.date === '2026-08-13')?.items).toHaveLength(0)
  })

  it('low point is flagged on the correct day', () => {
    const state = dashboardState(100_000)
    const category = categoryIds(state)
    state.transactions = [
      transaction(state, { id: 'bill', title: 'Large bill', amountCents: 80_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-13' }),
      transaction(state, { id: 'income', title: 'Payday', amountCents: 57_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-14' }),
    ]

    expect(buildMobileDashboardModel(state, referenceDate).horizon.find((event) => event.isLowPoint)?.date).toBe('2026-08-13')
  })

  it('After tomorrow ignores movements after tomorrow', () => {
    const state = dashboardState(50_000)
    const category = categoryIds(state)
    state.transactions = [
      transaction(state, { id: 'bill', title: 'Large bill', amountCents: 80_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-13' }),
      transaction(state, { id: 'income', title: 'Payday', amountCents: 57_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-14' }),
    ]

    expect(buildMobileDashboardModel(state, referenceDate).afterTomorrowCents).toBe(50_000)
  })

  it('household with no income at all does not crash', () => {
    const state = dashboardState()
    expect(() => buildMobileDashboardModel(state, referenceDate)).not.toThrow()
    const model = buildMobileDashboardModel(state, referenceDate)
    expect(model.nextIncome).toBeNull()
    expect(model.horizon).toHaveLength(7)
  })

  it('debt fields are populated from buildDebtSummary', () => {
    const state = dashboardState()
    state.accounts.push({
      id: 'cc-1', householdId: state.household.id, name: 'Visa', institution: '', type: 'credit-card', currency: 'EUR',
      openingBalanceCents: -50_000, currentBalanceCents: -30_000, holder: '', accentColor: '#d97757', archived: false, notes: '',
    })

    const model = buildMobileDashboardModel(state, referenceDate)
    expect(model.totalOwedCents).toBe(30_000)
    expect(model.debt.isDebtFree).toBe(false)
  })
})
