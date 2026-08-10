import { describe, expect, it } from 'vitest'
import { buildVisibleItems } from '@/domain/home'
import { buildPlannerCycleSummary, buildPlanningWeeks } from '@/domain/planning'
import {
  moveOneOffPlannerItem,
  updateOneOffPlannerAmount,
  updatePlannerSeriesFromOccurrence,
  upsertPlannerOccurrenceOverride,
} from '@/domain/planner-actions'
import { createBlankState } from '@/domain/seed'
import type { AppState, RecurringRule, Transaction } from '@/domain/model'

const reference = new Date('2026-09-01T12:00:00')

function fixture() {
  const state = createBlankState()
  state.settings.weekStartDay = 4
  state.household.weekStartDay = 4
  state.accounts = [{
    id: 'main-account',
    householdId: state.household.id,
    name: 'Main account',
    institution: 'Local',
    type: 'current',
    currency: 'EUR',
    openingBalanceCents: 100_000,
    currentBalanceCents: 100_000,
    holder: 'Household',
    accentColor: '#2F7D5B',
    archived: false,
    notes: '',
  }]
  const incomeCategoryId = state.categories.find((category) => ['Income', 'Receitas'].includes(category.group))!.id
  const expenseCategoryId = state.categories.find((category) => !['Income', 'Receitas', 'Transfers', 'Movimento'].includes(category.group))!.id
  return { state, incomeCategoryId, expenseCategoryId }
}

function transaction(state: AppState, title: string, date: string, amountCents: number, categoryId: string, type: 'income' | 'expense' = 'expense'): Transaction {
  return {
    id: `${title}-${date}`,
    householdId: state.household.id,
    title,
    description: title,
    amountCents,
    type,
    categoryId,
    accountId: state.accounts[0].id,
    transactionDate: date,
    dueDate: date,
    status: 'planned',
    tags: [],
    notes: '',
    source: 'manual',
    splits: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

function rule(state: AppState, categoryId: string): RecurringRule {
  return {
    id: 'weekly-rule',
    householdId: state.household.id,
    name: 'Weekly rent',
    amountCents: 20_000,
    frequency: 'weekly',
    interval: 1,
    nextDueDate: '2026-09-03',
    accountId: state.accounts[0].id,
    categoryId,
    generateAutomatically: true,
    reminder: true,
    active: true,
  }
}

function weeks(state: AppState) {
  return buildPlanningWeeks(state, '2026-09-01', '2026-09-30', reference, 0, 100_000)
}

describe('interactive planner domain actions', () => {
  it('moves a one-off inside one week and recalculates both daily totals without changing that week closing', () => {
    const { state, expenseCategoryId } = fixture()
    state.transactions.push(transaction(state, 'Phone', '2026-09-01', 2_500, expenseCategoryId))
    const item = buildVisibleItems(state, '2026-09-01', '2026-09-02', reference)[0]
    const before = weeks(state)[0]

    const next = moveOneOffPlannerItem(state, item, '2026-09-02', '2026-08-04T12:00:00.000Z')
    const after = weeks(next)[0]

    expect(next.transactions[0]).toMatchObject({ transactionDate: '2026-09-02', dueDate: '2026-09-02' })
    expect(after.days.find((day) => day.date === '2026-09-01')?.expenseCents).toBe(0)
    expect(after.days.find((day) => day.date === '2026-09-02')?.expenseCents).toBe(2_500)
    expect(after.closingBalanceCents).toBe(before.closingBalanceCents)
  })

  it('moves a one-off between weeks and carries the changed closing into every following opening', () => {
    const { state, expenseCategoryId } = fixture()
    state.transactions.push(transaction(state, 'Rent', '2026-09-01', 20_000, expenseCategoryId))
    const item = buildVisibleItems(state, '2026-09-01', '2026-09-01', reference)[0]
    const before = weeks(state)
    const summaryBefore = buildPlannerCycleSummary(before)

    const next = moveOneOffPlannerItem(state, item, '2026-09-03', '2026-08-04T12:00:00.000Z')
    const after = weeks(next)
    const summaryAfter = buildPlannerCycleSummary(after)

    expect(after[0].closingBalanceCents).toBe(before[0].closingBalanceCents + 20_000)
    expect(after[1].openingBalanceCents).toBe(after[0].closingBalanceCents)
    expect(after.slice(1).every((week, index) => week.openingBalanceCents === after[index].closingBalanceCents)).toBe(true)
    expect(summaryAfter).toEqual(summaryBefore)
    expect(summaryAfter.closingBalanceCents).toBe(after.at(-1)?.closingBalanceCents)
  })

  it('moves only one virtual recurrence by creating one anchored override without changing its rule', () => {
    const { state, expenseCategoryId } = fixture()
    const recurringRule = rule(state, expenseCategoryId)
    state.recurringRules.push(recurringRule)
    const item = buildVisibleItems(state, '2026-09-03', '2026-09-10', reference).find((entry) => entry.date === '2026-09-03')!

    const next = upsertPlannerOccurrenceOverride(state, item, recurringRule, { targetDate: '2026-09-05', id: 'override', now: '2026-08-04T12:00:00.000Z' })
    const visible = buildVisibleItems(next, '2026-09-03', '2026-09-10', reference)

    expect(next.recurringRules[0].nextDueDate).toBe('2026-09-03')
    expect(next.transactions).toHaveLength(1)
    expect(next.transactions[0]).toMatchObject({ transactionDate: '2026-09-03', dueDate: '2026-09-05', recurrenceRuleId: recurringRule.id })
    expect(visible.filter((entry) => entry.title === recurringRule.name).map((entry) => entry.date)).toEqual(['2026-09-05', '2026-09-10'])
  })

  it('updates this and following occurrences while preserving completed history and removing planned future overrides', () => {
    const { state, expenseCategoryId } = fixture()
    const recurringRule = rule(state, expenseCategoryId)
    state.recurringRules.push(recurringRule)
    const completed = { ...transaction(state, 'Paid history', '2026-09-03', 20_000, expenseCategoryId), id: 'completed', recurrenceRuleId: recurringRule.id, status: 'paid' as const }
    const planned = { ...transaction(state, 'Future override', '2026-09-10', 22_000, expenseCategoryId), id: 'future', recurrenceRuleId: recurringRule.id }
    const tombstone = { ...transaction(state, 'Cancelled occurrence', '2026-09-17', 20_000, expenseCategoryId), id: 'tombstone', recurrenceRuleId: recurringRule.id, status: 'cancelled' as const }
    state.transactions.push(completed, planned, tombstone)
    const item = buildVisibleItems(state, '2026-09-10', '2026-09-10', reference)[0]

    const next = updatePlannerSeriesFromOccurrence(state, item, recurringRule, { nextDueDate: '2026-09-12', amountCents: 21_500, updatedAt: '2026-08-04T12:00:00.000Z' })

    expect(next.recurringRules[0]).toMatchObject({ nextDueDate: '2026-09-12', amountCents: 21_500 })
    expect(next.transactions.some((entry) => entry.id === 'completed')).toBe(true)
    expect(next.transactions.some((entry) => entry.id === 'future')).toBe(false)
    expect(next.transactions.some((entry) => entry.id === 'tombstone')).toBe(true)
  })

  it('edits amounts strictly as integer cents and recalculates totals', () => {
    const { state, expenseCategoryId } = fixture()
    state.transactions.push(transaction(state, 'Groceries', '2026-09-01', 10_000, expenseCategoryId))
    const item = buildVisibleItems(state, '2026-09-01', '2026-09-01', reference)[0]

    const next = updateOneOffPlannerAmount(state, item, Math.round(123.45 * 100), '2026-08-04T12:00:00.000Z')
    const day = weeks(next)[0].days.find((entry) => entry.date === '2026-09-01')!

    expect(next.transactions[0].amountCents).toBe(12_345)
    expect(Number.isInteger(next.transactions[0].amountCents)).toBe(true)
    expect(day.expenseCents).toBe(12_345)
  })

  it('does not silently move a completed item', () => {
    const { state, expenseCategoryId } = fixture()
    state.transactions.push({ ...transaction(state, 'Paid bill', '2026-09-01', 4_000, expenseCategoryId), status: 'paid' })
    const item = buildVisibleItems(state, '2026-09-01', '2026-09-01', reference)[0]

    const next = moveOneOffPlannerItem(state, item, '2026-09-02', '2026-08-04T12:00:00.000Z')

    expect(next).toBe(state)
    expect(next.transactions[0].transactionDate).toBe('2026-09-01')
  })
})
