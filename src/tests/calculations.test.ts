import { describe, expect, it } from 'vitest'
import { addDays } from 'date-fns'
import { calculateDashboardSummary, ensureCalculatedState } from '@/domain/calculations'
import { createDemoState } from '@/domain/seed'

describe('financial calculations', () => {
  it('keeps consolidated balance unchanged for transfers', () => {
    const state = ensureCalculatedState(createDemoState())
    const [accountA, accountB] = state.accounts.slice(0, 2)
    state.accounts = [
      { ...accountA, openingBalanceCents: 100_000, currentBalanceCents: 100_000 },
      { ...accountB, openingBalanceCents: 50_000, currentBalanceCents: 50_000 },
      ...state.accounts.slice(2),
    ]
    state.transactions = [
      {
        id: crypto.randomUUID(),
        householdId: state.household.id,
        title: 'Transferência',
        description: 'Mover dinheiro entre contas',
        amountCents: 25_000,
        type: 'transfer',
        categoryId: state.categories[0].id,
        accountId: state.accounts[0].id,
        counterpartyAccountId: state.accounts[1].id,
        transactionDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date().toISOString().slice(0, 10),
        paidDate: new Date().toISOString().slice(0, 10),
        status: 'paid',
        tags: [],
        notes: '',
        source: 'manual',
        splits: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]

    const expectedTotal = state.accounts.reduce((sum, account) => sum + account.openingBalanceCents, 0)
    const calculated = ensureCalculatedState(state)
    const total = calculated.accounts.reduce((sum, account) => sum + account.currentBalanceCents, 0)
    expect(total).toBe(expectedTotal)
    expect(calculateDashboardSummary(calculated).consolidatedBalanceCents).toBe(expectedTotal)
  })

  it('builds a sensible dashboard from demo data', () => {
    const state = ensureCalculatedState(createDemoState())
    const summary = calculateDashboardSummary(state)

    expect(summary.monthlyIncomeCents).toBeGreaterThan(0)
    expect(summary.monthlyExpenseCents).toBeGreaterThan(0)
    expect(summary.projection).toHaveLength(30)
    expect(summary.healthScore).toBeGreaterThanOrEqual(0)
  })

  it('supports date arithmetic across month boundaries', () => {
    const current = new Date(2024, 1, 28)
    const next = addDays(current, 3)
    expect(next.getMonth()).toBe(2)
  })
})
