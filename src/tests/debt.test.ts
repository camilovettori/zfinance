import { addMonths, subMonths } from 'date-fns'
import { describe, expect, it } from 'vitest'
import { buildDebtSummary, LIABILITY_ACCOUNT_TYPES } from '@/domain/debt'
import { createBlankState } from '@/domain/seed'
import type { FinancialAccount, RecurringRule, Transaction } from '@/domain/model'
import { toIsoDate } from '@/lib/date'

function account(overrides: Partial<FinancialAccount>, householdId: string): FinancialAccount {
  return {
    id: crypto.randomUUID(),
    householdId,
    name: 'Account',
    institution: 'Local',
    type: 'current',
    currency: 'EUR',
    openingBalanceCents: 0,
    currentBalanceCents: 0,
    holder: 'Household',
    accentColor: '#000000',
    archived: false,
    notes: '',
    ...overrides,
  }
}

function fixture() {
  const state = createBlankState()
  return { state }
}

function transaction(overrides: Partial<Transaction>, householdId: string, categoryId: string, accountId: string): Transaction {
  return {
    id: crypto.randomUUID(),
    householdId,
    title: 'Payment',
    description: 'Payment',
    amountCents: 0,
    type: 'expense',
    categoryId,
    accountId,
    transactionDate: '2026-01-01',
    status: 'paid',
    tags: [],
    notes: '',
    source: 'manual',
    splits: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function rule(overrides: Partial<RecurringRule>, householdId: string, categoryId: string, accountId: string): RecurringRule {
  return {
    id: crypto.randomUUID(),
    householdId,
    name: 'Card payment',
    amountCents: 0,
    frequency: 'monthly',
    interval: 1,
    nextDueDate: '2026-09-01',
    accountId,
    categoryId,
    generateAutomatically: true,
    reminder: false,
    active: true,
    ...overrides,
  }
}

describe('buildDebtSummary — liability accounts', () => {
  it('reports the same owed total whether the balance was entered as negative or positive', () => {
    const { state } = fixture()
    const negative = account({ name: 'Visa', type: 'credit-card', currentBalanceCents: -52_300 }, state.household.id)
    const positive = account({ name: 'Revolut', type: 'credit-card', currentBalanceCents: 25_000 }, state.household.id)
    state.accounts = [negative, positive]

    const summary = buildDebtSummary(state)

    expect(summary.accounts).toHaveLength(2)
    expect(summary.accounts.find((entry) => entry.accountId === negative.id)?.owedCents).toBe(52_300)
    expect(summary.accounts.find((entry) => entry.accountId === positive.id)?.owedCents).toBe(25_000)
    expect(summary.totalOwedCents).toBe(77_300)
  })

  it('excludes archived liability accounts', () => {
    const { state } = fixture()
    const active = account({ type: 'loan', currentBalanceCents: -10_000 }, state.household.id)
    const archived = account({ type: 'loan', currentBalanceCents: -5_000, archived: true }, state.household.id)
    state.accounts = [active, archived]

    const summary = buildDebtSummary(state)

    expect(summary.accounts).toHaveLength(1)
    expect(summary.totalOwedCents).toBe(10_000)
  })

  it('only counts the three liability account types', () => {
    expect(LIABILITY_ACCOUNT_TYPES).toEqual(['credit-card', 'loan', 'financing'])
    const { state } = fixture()
    state.accounts = [
      account({ type: 'current', currentBalanceCents: -1_000 }, state.household.id),
      account({ type: 'savings', currentBalanceCents: -2_000 }, state.household.id),
    ]

    const summary = buildDebtSummary(state)

    expect(summary.accounts).toHaveLength(0)
    expect(summary.totalOwedCents).toBe(0)
  })

  it('returns a debt-free summary for a household with no liability accounts', () => {
    const { state } = fixture()
    state.accounts = [account({ type: 'current', currentBalanceCents: 100_000 }, state.household.id)]

    const summary = buildDebtSummary(state)

    expect(summary.totalOwedCents).toBe(0)
    expect(summary.isDebtFree).toBe(true)
    expect(summary.payoffDateIso).toBeNull()
    expect(summary.paidOffPercent).toBe(100)
  })

  it('computes paid-off amount and percent from opening vs current balance', () => {
    const { state } = fixture()
    state.accounts = [
      account({ type: 'credit-card', openingBalanceCents: -100_000, currentBalanceCents: -40_000 }, state.household.id),
    ]

    const summary = buildDebtSummary(state)

    expect(summary.originalTotalCents).toBe(100_000)
    expect(summary.totalOwedCents).toBe(40_000)
    expect(summary.paidOffCents).toBe(60_000)
    expect(summary.paidOffPercent).toBe(60)
  })

  it('floors paid-off percent at 0 when debt has grown past the opening balance', () => {
    const { state } = fixture()
    state.accounts = [
      account({ type: 'credit-card', openingBalanceCents: -10_000, currentBalanceCents: -15_000 }, state.household.id),
    ]

    const summary = buildDebtSummary(state)

    expect(summary.paidOffCents).toBe(0)
    expect(summary.paidOffPercent).toBe(0)
  })
})

describe('buildDebtSummary — payoff projection', () => {
  const referenceDate = new Date('2026-08-11T12:00:00')

  it('projects a payoff date from 3 months of completed liability payments', () => {
    const { state } = fixture()
    const card = account({ type: 'credit-card', currentBalanceCents: -60_000 }, state.household.id)
    state.accounts = [card]
    const categoryId = state.categories[0].id
    const months = [subMonths(referenceDate, 1), subMonths(referenceDate, 2), subMonths(referenceDate, 3)]
    state.transactions = months.map((month) =>
      transaction({ amountCents: 10_000, transactionDate: toIsoDate(month), status: 'paid', type: 'expense' }, state.household.id, categoryId, card.id),
    )

    const summary = buildDebtSummary(state, referenceDate)

    expect(summary.monthlyPaymentPaceCents).toBe(10_000)
    expect(summary.monthsRemaining).toBe(6)
    expect(summary.payoffDateIso).toBe(toIsoDate(addMonths(referenceDate, 6)))
  })

  it('counts transfers into a liability account as payments', () => {
    const { state } = fixture()
    const spending = account({ type: 'current', currentBalanceCents: 200_000 }, state.household.id)
    const card = account({ type: 'credit-card', currentBalanceCents: -30_000 }, state.household.id)
    state.accounts = [spending, card]
    const categoryId = state.categories[0].id
    state.transactions = [subMonths(referenceDate, 1), subMonths(referenceDate, 2), subMonths(referenceDate, 3)].map((month) =>
      transaction(
        { amountCents: 5_000, transactionDate: toIsoDate(month), status: 'paid', type: 'transfer', accountId: spending.id, counterpartyAccountId: card.id },
        state.household.id,
        categoryId,
        spending.id,
      ),
    )

    const summary = buildDebtSummary(state, referenceDate)

    expect(summary.monthlyPaymentPaceCents).toBe(5_000)
  })

  it('falls back to recurring rules when there is no payment history', () => {
    const { state } = fixture()
    const card = account({ type: 'credit-card', currentBalanceCents: -24_000 }, state.household.id)
    state.accounts = [card]
    const categoryId = state.categories[0].id
    state.recurringRules = [rule({ amountCents: 2_000, frequency: 'monthly' }, state.household.id, categoryId, card.id)]

    const summary = buildDebtSummary(state, referenceDate)

    expect(summary.monthlyPaymentPaceCents).toBe(2_000)
    expect(summary.monthsRemaining).toBe(12)
  })

  it('never fabricates a payoff date when the pace is zero', () => {
    const { state } = fixture()
    state.accounts = [account({ type: 'credit-card', currentBalanceCents: -24_000 }, state.household.id)]

    const summary = buildDebtSummary(state, referenceDate)

    expect(summary.monthlyPaymentPaceCents).toBe(0)
    expect(summary.monthsRemaining).toBeNull()
    expect(summary.payoffDateIso).toBeNull()
  })

  it('ignores inactive recurring rules in the fallback', () => {
    const { state } = fixture()
    const card = account({ type: 'credit-card', currentBalanceCents: -24_000 }, state.household.id)
    state.accounts = [card]
    const categoryId = state.categories[0].id
    state.recurringRules = [rule({ amountCents: 2_000, frequency: 'monthly', active: false }, state.household.id, categoryId, card.id)]

    const summary = buildDebtSummary(state, referenceDate)

    expect(summary.monthlyPaymentPaceCents).toBe(0)
  })
})
