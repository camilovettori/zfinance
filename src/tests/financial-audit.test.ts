import { describe, expect, it } from 'vitest'
import { addDays } from 'date-fns'
import { createBlankState } from '@/domain/seed'
import { buildVisibleItems } from '@/domain/home'
import { calculateDashboardSummary, calculateForecast, ensureCalculatedState } from '@/domain/calculations'
import { buildPlannerCycleSummary, buildPlannerOpeningBalance, buildPlanningWeeks, buildPlannerWeeksWithCarry, createPlannerCycle, movePlannerCycle } from '@/domain/planning'
import type { AppState, RecurringRule, Transaction } from '@/domain/model'
import { fromIsoDate, toIsoDate } from '@/lib/date'

function fixture(opening = 812194) {
  const state = createBlankState()
  state.household.currency = state.settings.currency = 'EUR'
  state.household.weekStartDay = state.settings.weekStartDay = 1
  state.accounts = [{ id: 'bank', householdId: state.household.id, name: 'Bank', institution: '', type: 'current', currency: 'EUR', openingBalanceCents: opening, currentBalanceCents: opening, holder: '', accentColor: '', archived: false, notes: '' }]
  return state
}

function tx(state: AppState, date: string, type: 'income' | 'expense', amountCents: number, status: Transaction['status'] = 'planned'): Transaction {
  return { id: crypto.randomUUID(), householdId: state.household.id, accountId: 'bank',
    categoryId: state.categories.find((category) => type === 'income' ? category.group === 'Income' : category.group !== 'Income')!.id,
    title: `${type} ${date}`, description: '', type, amountCents, transactionDate: date, dueDate: date,
    status, tags: [], notes: '', source: 'manual', splits: [], createdAt: '2026-11-03T12:00:00.000Z', updatedAt: '2026-11-03T12:00:00.000Z' }
}

function rule(state: AppState, date: string, frequency: RecurringRule['frequency'] = 'monthly'): RecurringRule {
  return { id: crypto.randomUUID(), householdId: state.household.id, accountId: 'bank', categoryId: state.categories.find((category) => category.group === 'Income')!.id,
    name: 'Salary', amountCents: 288300, nextDueDate: date, frequency, interval: 1, active: true, generateAutomatically: true, reminder: true, adjustToPrevFriday: true }
}

describe('independent financial reconciliation audit', () => {
  it('reproduces the screenshot: the selected week and the full cycle have different, correct closing balances', () => {
    const state = fixture(855063)
    state.transactions = [tx(state, '2026-12-07', 'expense', 61552), tx(state, '2026-12-18', 'income', 57070),
      tx(state, '2026-12-25', 'income', 459510), tx(state, '2026-12-27', 'expense', 327761)]
    for (const [date, cents] of [['15', 5166], ['16', 1], ['17', 1000], ['17', 399], ['18', 4800], ['18', 4116], ['18', 3720], ['18', 6887], ['18', 2000], ['18', 399], ['19', 15000], ['20', 6850], ['20', 6500]] as const) {
      state.transactions.push(tx(state, `2026-12-${date}`, 'expense', cents))
    }
    const weeks = buildPlanningWeeks(state, '2026-12-01', '2026-12-31', new Date(2026, 10, 3), 0, 855063, { start: '2026-12-07', end: '2027-01-03' })
    const selected = weeks.find((week) => week.start === '2026-12-14')!
    expect(selected).toMatchObject({ openingBalanceCents: 793511, incomeCents: 57070, expenseCents: 56838, closingBalanceCents: 793743 })
    expect(buildPlannerCycleSummary(weeks)).toMatchObject({ openingBalanceCents: 855063, incomeCents: 516580, expenseCents: 446151, closingBalanceCents: 925492 })
  })

  it('anchors the current day to the confirmed bank balance instead of deducting old pending bills again', () => {
    const state = fixture()
    state.transactions = [tx(state, '2026-10-30', 'expense', 10000), tx(state, '2026-11-02', 'income', 50000), tx(state, '2026-11-04', 'expense', 1234)]
    const reference = new Date(2026, 10, 3)
    const opening = buildPlannerOpeningBalance(state, '2026-10-26', reference)
    const weeks = buildPlanningWeeks(state, '2026-11-01', '2026-11-30', reference, 0, opening)
    const days = weeks.flatMap((week) => week.days)
    expect(days.find((day) => day.date === '2026-11-03')!.closingBalanceCents).toBe(812194)
    expect(days.find((day) => day.date === '2026-11-04')!.closingBalanceCents).toBe(810960)
    expect(state.accounts[0].openingBalanceCents).toBe(812194)
  })

  it('proves each day, week and cycle equation and carries balances over twelve months including the year boundary', () => {
    const state = fixture()
    const reference = new Date(2026, 10, 3)
    state.recurringRules = [rule(state, '2026-11-25'), { ...rule(state, '2026-11-06', 'weekly'), name: 'Bill', amountCents: 8771, categoryId: state.categories.find((category) => category.group !== 'Income')!.id }]
    const anchor = createPlannerCycle(state, '2026-11-01', '2026-11-30')
    let cycle = anchor
    let precedingClosing: number | undefined
    for (let month = 0; month < 12; month++) {
      const weeks = buildPlannerWeeksWithCarry(state, anchor, cycle, reference, 812194, () => 0)
      if (precedingClosing !== undefined) expect(weeks[0].openingBalanceCents).toBe(precedingClosing)
      for (let index = 0; index < weeks.length; index++) {
        const week = weeks[index]
        let running = week.openingBalanceCents
        for (const day of week.days) {
          running += day.incomeCents - day.expenseCents
          expect(day.closingBalanceCents).toBe(running)
        }
        expect(week.closingBalanceCents).toBe(running - week.plannedSavingsCents)
        if (index) expect(week.openingBalanceCents).toBe(weeks[index - 1].closingBalanceCents)
      }
      const summary = buildPlannerCycleSummary(weeks)
      expect(summary.closingBalanceCents).toBe(summary.openingBalanceCents + summary.incomeCents - summary.expenseCents - summary.savingsAllocationCents)
      precedingClosing = summary.closingBalanceCents
      const next = movePlannerCycle(state, cycle, 1)
      expect(next.plannerRange.start).toBe(toIsoDate(addDays(fromIsoDate(cycle.plannerRange.end), 1)))
      cycle = next
    }
  })

  it('keeps month-end recurrences anchored and stops generating after the end date', () => {
    const state = fixture()
    state.recurringRules = [{ ...rule(state, '2027-01-31'), adjustToPrevFriday: false, endDate: '2027-03-31' }]
    expect(buildVisibleItems(state, '2027-01-01', '2027-05-31', new Date(2027, 0, 1)).map((item) => item.date))
      .toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
  })

  it('forecasts repeated salary and one-off bills without inventing or counting completed expenses twice', () => {
    const state = fixture()
    state.recurringRules = [rule(state, '2026-11-25')]
    state.transactions = [tx(state, '2026-11-15', 'expense', 12345, 'paid'), tx(state, '2026-12-10', 'expense', 1000)]
    const calculated = ensureCalculatedState(state)
    const forecast = calculateForecast(calculated, new Date(2026, 11, 1), 62)
    expect(forecast.projection.reduce((total, day) => total + day.incomeCents, 0)).toBe(576600)
    expect(forecast.projection.reduce((total, day) => total + day.expenseCents, 0)).toBe(1000)
    expect(forecast.projection.at(-1)!.projectedBalanceCents).toBe(calculated.accounts[0].currentBalanceCents + 576600 - 1000)
  })

  it('limits category totals to the selected period and counts split expenses exactly once', () => {
    const state = fixture()
    const expense = tx(state, '2026-12-15', 'expense', 10000)
    expense.splits = [
      { id: 'a', transactionId: expense.id, categoryId: state.categories[2].id, amountCents: 4000 },
      { id: 'b', transactionId: expense.id, categoryId: state.categories[3].id, amountCents: 6000 },
    ]
    state.transactions = [expense, tx(state, '2026-11-15', 'expense', 99999)]
    const summary = calculateDashboardSummary(state, { period: 'custom', startDate: '2026-12-01', endDate: '2026-12-31', status: 'all' })
    expect(summary.topCategories.reduce((total, category) => total + category.amountCents, 0)).toBe(10000)
  })
})
