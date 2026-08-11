import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileDashboard } from '@/app/dashboard/MobileDashboard'
import { buildMobileDashboardModel } from '@/app/dashboard/mobile-dashboard-model'
import { buildRollingBalanceProjection } from '@/domain/cashflow'
import { createBlankState } from '@/domain/seed'
import type { AppState, RecurringRule, Transaction } from '@/domain/model'
import { buildPlanningWeeks, createPlannerCycle, savingsContributedInRange } from '@/domain/planning'

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

describe('mobile dashboard', () => {
  it('renders tomorrow, after-tomorrow balance, and grouped next income', () => {
    const state = dashboardState()
    const category = categoryIds(state)
    state.transactions = [
      transaction(state, { id: 'income-a', title: 'Iris Wages', amountCents: 57_070, type: 'income', categoryId: category.income, transactionDate: '2026-08-12' }),
      transaction(state, { id: 'income-b', title: 'Partner Wages', amountCents: 53_552, type: 'income', categoryId: category.income, transactionDate: '2026-08-12' }),
      transaction(state, { id: 'bill-a', title: 'Electricity', amountCents: 40_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-12' }),
    ]

    const model = buildMobileDashboardModel(state, referenceDate)
    expect(model.tomorrowItems.map((item) => item.title)).toEqual(['Iris Wages', 'Partner Wages', 'Electricity'])
    expect(model.tomorrowIncomingCents).toBe(110_622)
    expect(model.tomorrowDueCents).toBe(40_000)
    expect(model.afterTomorrowCents).toBe(170_622)
    expect(model.nextIncome?.items).toHaveLength(2)
    expect(model.nextIncome?.totalCents).toBe(110_622)

    render(<MobileDashboard state={state} referenceDate={referenceDate} onEditItem={vi.fn()} onAddIncome={vi.fn()} onAddBill={vi.fn()} />)
    expect(screen.getByText('Tomorrow')).toBeTruthy()
    expect(screen.getByText('2 incomes')).toBeTruthy()
    expect(screen.getAllByText(/€1,706\.22/).length).toBeGreaterThan(0)
  })

  it('shows a calm empty state when nothing is due tomorrow and no income is scheduled', () => {
    const model = buildMobileDashboardModel(dashboardState(), referenceDate)
    expect(model.tomorrowItems).toEqual([])
    expect(model.nextIncome).toBeNull()
    expect(model.afterTomorrowCents).toBe(100_000)
    expect(model.insight).toBe('nothing-tomorrow')
  })

  it('keeps negative balances explicit', () => {
    const state = dashboardState(-10_000)
    const category = categoryIds(state)
    state.transactions = [transaction(state, {
      id: 'bill-negative', title: 'Rent', amountCents: 20_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-12',
    })]

    const model = buildMobileDashboardModel(state, referenceDate)
    expect(model.availableNowCents).toBe(-10_000)
    expect(model.afterTomorrowCents).toBe(-30_000)
  })

  it('uses virtual recurrences without materializing transactions', () => {
    const state = dashboardState()
    const category = categoryIds(state)
    state.recurringRules = [recurringRule(state, {
      id: 'weekly-income', name: 'Recurring wages', amountCents: 57_070, nextDueDate: '2026-08-12', categoryId: category.income,
    })]

    const model = buildMobileDashboardModel(state, referenceDate)
    expect(model.tomorrowItems).toHaveLength(1)
    expect(model.tomorrowItems[0]).toMatchObject({ title: 'Recurring wages', sourceKind: 'recurring' })
    expect(model.nextIncome?.totalCents).toBe(57_070)
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

    expect(buildMobileDashboardModel(state, referenceDate).tomorrowItems).toEqual([])
  })

  it('uses the exact Planner week for Thursday–Wednesday opening, flows, savings, and closing', () => {
    const state = dashboardState(82_120)
    const category = categoryIds(state)
    state.goals = [{
      id: 'goal', householdId: state.household.id, name: 'Savings', targetCents: 500_000, currentCents: 0,
      monthlyContributionCents: 31_000, priority: 1, notes: '', archived: false,
    }]
    state.transactions = [
      transaction(state, { id: 'income', title: 'Income', amountCents: 110_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-13' }),
      transaction(state, { id: 'bill', title: 'Bills', amountCents: 74_024, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-14' }),
    ]

    const model = buildMobileDashboardModel(state, referenceDate)
    const cycle = createPlannerCycle(state, '2026-08-01', '2026-08-31')
    const savings = Math.max(31_000, savingsContributedInRange(state, cycle.plannerRange.start, cycle.plannerRange.end))
    const opening = buildRollingBalanceProjection(state, cycle.plannerRange.start, cycle.plannerRange.end, referenceDate).openingBalanceCents
    const plannerWeek = buildPlanningWeeks(state, '2026-08-01', '2026-08-31', referenceDate, savings, opening, cycle.plannerRange)
      .find((week) => week.start === '2026-08-06')

    expect(model.currentWeek.start).toBe('2026-08-06')
    expect(model.currentWeek.end).toBe('2026-08-12')
    expect(model.currentWeek).toEqual(plannerWeek)
  })
})
