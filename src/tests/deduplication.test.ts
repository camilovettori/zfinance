import { describe, expect, it } from 'vitest'
import { cleanupOneOffRecurringDuplicates } from '@/domain/deduplication'
import { createDemoState } from '@/domain/seed'
import type { Transaction } from '@/domain/model'

describe('one-off and recurring deduplication', () => {
  it('keeps the recurring rule and removes the matching planned one-off transaction', () => {
    const state = cleanupOneOffRecurringDuplicates(createDemoState()).state
    const rule = state.recurringRules[0]
    const duplicate: Transaction = {
      id: crypto.randomUUID(),
      householdId: state.household.id,
      title: rule.name,
      description: rule.name,
      amountCents: rule.amountCents,
      type: 'income',
      categoryId: rule.categoryId,
      accountId: rule.accountId,
      transactionDate: rule.nextDueDate,
      dueDate: rule.nextDueDate,
      status: 'planned',
      notes: '',
      source: 'manual',
      splits: [],
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    state.transactions.unshift(duplicate)

    const result = cleanupOneOffRecurringDuplicates(state)

    expect(result.removed).toHaveLength(1)
    expect(result.removed[0].transactionId).toBe(duplicate.id)
    expect(result.state.transactions.some((transaction) => transaction.id === duplicate.id)).toBe(false)
    expect(result.state.recurringRules.some((entry) => entry.id === rule.id)).toBe(true)
  })

  it('preserves completed transaction history even when it matches a recurring rule', () => {
    const state = cleanupOneOffRecurringDuplicates(createDemoState()).state
    const rule = state.recurringRules[0]
    const completed = state.transactions[0]
    completed.title = rule.name
    completed.amountCents = rule.amountCents
    completed.transactionDate = rule.nextDueDate
    completed.status = 'received'

    const result = cleanupOneOffRecurringDuplicates(state)

    expect(result.removed).toHaveLength(0)
    expect(result.state.transactions.some((transaction) => transaction.id === completed.id)).toBe(true)
  })
})
