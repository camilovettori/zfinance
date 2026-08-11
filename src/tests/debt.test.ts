import { describe, expect, it } from 'vitest'
import { buildDebtSummary, LIABILITY_ACCOUNT_TYPES } from '@/domain/debt'
import { createBlankState } from '@/domain/seed'
import type { FinancialAccount } from '@/domain/model'

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
