import { describe, expect, it } from 'vitest'
import { addDays } from 'date-fns'
import { calculateBudgetSummary, calculateDashboardSummary, ensureCalculatedState } from '@/domain/calculations'
import { createDemoState } from '@/domain/seed'

describe('financial calculations', () => {
  it('counts only completed current-month expenses in category and person budgets', () => {
    const state = createDemoState()
    const categoryId = state.categories[0].id
    const personId = state.members[0].id
    const today = new Date()
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const previous = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const previousMonth = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`
    const base = { ...state.transactions[0], categoryId, personId, type: 'expense' as const }
    state.transactions = [
      { ...base, id: 'current', transactionDate: `${month}-01`, amountCents: 1200, status: 'paid' },
      { ...base, id: 'previous', transactionDate: `${previousMonth}-01`, amountCents: 9000, status: 'paid' },
      { ...base, id: 'pending', transactionDate: `${month}-01`, amountCents: 3000, status: 'pending' },
      { ...base, id: 'cancelled', transactionDate: `${month}-01`, amountCents: 4000, status: 'cancelled' },
    ]
    state.budgets = (['general', 'category', 'person'] as const).map((scope) => ({
      ...state.budgets[0], id: scope, scope, categoryId, personId, archived: false, limitCents: 5000,
    }))

    for (const summary of calculateBudgetSummary(state)) {
      expect(summary.spent).toBe(1200)
      expect(summary.remaining).toBe(3800)
      expect(summary.consumedPercent).toBe(24)
    }
  })

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
