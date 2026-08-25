import { describe, expect, it } from 'vitest'
import { buildMonthlyBillsReport } from '@/domain/monthly-bills-report'
import { createDemoState } from '@/domain/seed'
import type { Transaction } from '@/domain/model'

describe('monthly bills report', () => {
  it('filters the selected month, sorts by local YYYY-MM-DD, totals bills, and includes virtual recurrences', () => {
    const state = createDemoState()
    state.settings.locale = 'en-IE'
    state.settings.currency = 'EUR'
    state.transactions = []
    state.recurringRules = []
    const expenseCategory = state.categories.find((category) => !['Income', 'Receitas'].includes(category.group))!
    const incomeCategory = state.categories.find((category) => ['Income', 'Receitas'].includes(category.group))!

    const transaction = (
      id: string,
      title: string,
      date: string,
      type: 'income' | 'expense',
      amountCents: number,
      categoryId: string,
      status: Transaction['status'] = 'planned',
    ): Transaction => ({
      id,
      householdId: state.household.id,
      title,
      description: title,
      amountCents,
      type,
      categoryId,
      accountId: state.accounts[0].id,
      transactionDate: date,
      dueDate: date,
      status,
      tags: [],
      notes: '',
      source: 'manual',
      splits: [],
      createdAt: '2026-08-01T09:00:00.000Z',
      updatedAt: '2026-08-01T09:00:00.000Z',
    })

    state.transactions = [
      transaction('late-bill', 'Council tax', '2026-08-20', 'expense', 10_000, expenseCategory.id),
      transaction('early-bill', 'Electricity', '2026-08-05', 'expense', 5_000, expenseCategory.id, 'paid'),
      transaction('income', 'Salary', '2026-08-10', 'income', 100_000, incomeCategory.id),
      transaction('outside', 'September rent', '2026-09-01', 'expense', 80_000, expenseCategory.id),
      transaction('cancelled', 'Cancelled bill', '2026-08-08', 'expense', 7_000, expenseCategory.id, 'cancelled'),
    ]
    state.recurringRules = [{
      id: 'virtual-recurring-bill',
      householdId: state.household.id,
      name: 'Internet',
      amountCents: 3_000,
      frequency: 'monthly',
      interval: 1,
      nextDueDate: '2026-07-12',
      accountId: state.accounts[0].id,
      categoryId: expenseCategory.id,
      generateAutomatically: false,
      reminder: true,
      active: true,
    }]

    const report = buildMonthlyBillsReport(state, new Date(2026, 7, 18), new Date(2026, 7, 1, 12))

    expect(report).toMatchObject({ start: '2026-08-01', end: '2026-08-31', totalCents: 18_000 })
    expect(report.items.map((item) => [item.date, item.title])).toEqual([
      ['2026-08-05', 'Electricity'],
      ['2026-08-12', 'Internet'],
      ['2026-08-20', 'Council tax'],
    ])
    expect(report.items[1]).toMatchObject({ sourceKind: 'recurring', categoryName: expenseCategory.name })
    expect(state.transactions.some((item) => item.title === 'Internet')).toBe(false)
    expect(report.items.map((item) => item.title)).not.toContain('Salary')
    expect(report.items.map((item) => item.title)).not.toContain('September rent')
    expect(report.items.map((item) => item.title)).not.toContain('Cancelled bill')
  })
})
