import { describe, expect, it } from 'vitest'
import { addDays } from 'date-fns'
import { buildRollingBalanceProjection } from '@/domain/cashflow'
import { ensureCalculatedState } from '@/domain/calculations'
import { createBlankState } from '@/domain/seed'
import type { Transaction } from '@/domain/model'
import { todayIso, toIsoDate } from '@/lib/date'

const makeTransaction = (
  state: ReturnType<typeof createBlankState>,
  accountId: string,
  categoryId: string,
  date: string,
  type: 'income' | 'expense',
  amountCents: number,
  status: Transaction['status'] = 'planned',
): Transaction => ({
  id: crypto.randomUUID(),
  householdId: state.household.id,
  title: type === 'income' ? 'Income' : 'Bill',
  description: '',
  amountCents,
  type,
  categoryId,
  accountId,
  transactionDate: date,
  dueDate: date,
  status,
  tags: [],
  notes: '',
  source: 'manual',
  splits: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

describe('rolling weekly balances', () => {
  it('carries one week closing balance into the following week', () => {
    const state = createBlankState()
    const accountId = 'main-account'
    state.accounts = [{ id: accountId, householdId: state.household.id, name: 'Main', institution: 'Local', type: 'current', currency: 'EUR', openingBalanceCents: 100_000, currentBalanceCents: 100_000, holder: 'Household', accentColor: '#2F7D5B', archived: false, notes: '' }]
    const incomeCategory = state.categories.find((category) => ['Income', 'Receitas'].includes(category.group))!.id
    const expenseCategory = state.categories.find((category) => !['Income', 'Receitas', 'Transfers', 'Movimento'].includes(category.group))!.id
    const anchor = new Date(`${todayIso()}T12:00:00`)
    const firstStart = toIsoDate(addDays(anchor, 7))
    const firstEnd = toIsoDate(addDays(anchor, 13))
    const secondStart = toIsoDate(addDays(anchor, 14))
    const secondEnd = toIsoDate(addDays(anchor, 20))
    state.transactions.push(
      makeTransaction(state, accountId, incomeCategory, firstStart, 'income', 50_000),
      makeTransaction(state, accountId, expenseCategory, firstStart, 'expense', 20_000),
      makeTransaction(state, accountId, expenseCategory, secondStart, 'expense', 10_000),
    )

    const firstWeek = buildRollingBalanceProjection(state, firstStart, firstEnd, anchor)
    const secondWeek = buildRollingBalanceProjection(state, secondStart, secondEnd, anchor)

    expect(firstWeek.openingBalanceCents).toBe(100_000)
    expect(firstWeek.closingBalanceCents).toBe(130_000)
    expect(secondWeek.openingBalanceCents).toBe(firstWeek.closingBalanceCents)
    expect(secondWeek.closingBalanceCents).toBe(120_000)
  })

  it('does not subtract overdue bills until they are marked paid', () => {
    const state = createBlankState()
    const accountId = 'main-account'
    state.accounts = [{ id: accountId, householdId: state.household.id, name: 'Main', institution: 'Local', type: 'current', currency: 'EUR', openingBalanceCents: 100_000, currentBalanceCents: 100_000, holder: 'Household', accentColor: '#2F7D5B', archived: false, notes: '' }]
    const expenseCategory = state.categories.find((category) => !['Income', 'Receitas', 'Transfers', 'Movimento'].includes(category.group))!.id
    state.transactions.push(makeTransaction(state, accountId, expenseCategory, todayIso(), 'expense', 20_000, 'overdue'))

    expect(ensureCalculatedState(state).accounts[0].currentBalanceCents).toBe(100_000)
  })
})
