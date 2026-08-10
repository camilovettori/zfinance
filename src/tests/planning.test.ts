import { describe, expect, it } from 'vitest'
import { endOfMonth, startOfMonth } from 'date-fns'
import { buildCategoryDistribution, buildVisibleItems, summarizeRange } from '@/domain/home'
import { buildRollingBalanceProjection } from '@/domain/cashflow'
import { moveOneOffPlannerItem } from '@/domain/planner-actions'
import {
  buildPlannerCycleSummary,
  buildPlannerPeriodMetrics,
  buildPlanningWeeks,
  buildPlannerWeeksWithCarry,
  createPlannerCycle,
  expandPlanningRange,
  movePlannerCycle,
  savingsContributedInRange,
} from '@/domain/planning'
import { createBlankState, createDemoState } from '@/domain/seed'
import type { RecurringRule, Transaction } from '@/domain/model'
import { todayIso, toIsoDate } from '@/lib/date'

type TestState = ReturnType<typeof createBlankState>

const septemberRange = { start: '2026-09-01', end: '2026-09-30' }
const planningReference = new Date('2026-08-20T12:00:00')

const createPlanningState = (weekStartDay = 4) => {
  const state = createBlankState()
  state.household.currency = 'EUR'
  state.household.locale = 'en-IE'
  state.household.weekStartDay = weekStartDay
  state.settings.currency = 'EUR'
  state.settings.locale = 'en-IE'
  state.settings.weekStartDay = weekStartDay
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

const createCarryRegressionState = () => {
  const { state, incomeCategoryId, expenseCategoryId } = createPlanningState(4)
  state.accounts = [{
    ...state.accounts[0],
    openingBalanceCents: 8_212,
    currentBalanceCents: 8_212,
  }]
  state.transactions.push(
    makeTransaction(state, 'August carry income', '2026-08-27', 'income', 110_070, incomeCategoryId),
    makeTransaction(state, 'August carry bills', '2026-08-28', 'expense', 108_677, expenseCategoryId),
    makeTransaction(state, 'September carry income', '2026-09-03', 'income', 110_070, incomeCategoryId),
    makeTransaction(state, 'September carry bills', '2026-09-04', 'expense', 74_024, expenseCategoryId),
  )
  const augustCycle = createPlannerCycle(state, '2026-08-01', '2026-08-31')
  const septemberCycle = createPlannerCycle(state, '2026-09-01', '2026-09-30')
  return { state, augustCycle, septemberCycle, incomeCategoryId, expenseCategoryId }
}

const makeTransaction = (
  state: TestState,
  title: string,
  date: string,
  type: 'income' | 'expense',
  amountCents: number,
  categoryId: string,
  recurrenceRuleId?: string,
): Transaction => ({
  id: crypto.randomUUID(),
  householdId: state.household.id,
  title,
  description: title,
  amountCents,
  type,
  categoryId,
  accountId: 'main-account',
  transactionDate: date,
  dueDate: date,
  status: 'planned',
  recurrenceRuleId,
  tags: [],
  notes: '',
  source: 'manual',
  splits: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

const makeRule = (
  state: TestState,
  id: string,
  name: string,
  date: string,
  amountCents: number,
  categoryId: string,
): RecurringRule => ({
  id,
  householdId: state.household.id,
  name,
  amountCents,
  frequency: 'yearly',
  interval: 1,
  nextDueDate: date,
  accountId: 'main-account',
  categoryId,
  generateAutomatically: true,
  reminder: true,
  active: true,
})

const buildSeptemberPlanner = (state: TestState, plannedSavingsCents = 0) => {
  const plannerRange = expandPlanningRange(state, septemberRange.start, septemberRange.end)
  const openingBalance = buildRollingBalanceProjection(
    state,
    plannerRange.start,
    plannerRange.end,
    planningReference,
  ).openingBalanceCents
  return buildPlanningWeeks(
    state,
    septemberRange.start,
    septemberRange.end,
    planningReference,
    plannedSavingsCents,
    openingBalance,
  )
}

const createAugustCycleScenario = (weekStartDay = 4) => {
  const { state, incomeCategoryId, expenseCategoryId } = createPlanningState(weekStartDay)
  state.accounts[0].openingBalanceCents = 0
  state.accounts[0].currentBalanceCents = 0
  state.transactions.push(
    makeTransaction(state, 'Income 1', '2026-08-06', 'income', 110_000, incomeCategoryId),
    makeTransaction(state, 'Income 2', '2026-08-13', 'income', 110_000, incomeCategoryId),
    makeTransaction(state, 'Income 3', '2026-08-20', 'income', 110_000, incomeCategoryId),
    makeTransaction(state, 'Income 4', '2026-08-27', 'income', 110_000, incomeCategoryId),
    makeTransaction(state, 'August household bills', '2026-08-20', 'expense', 326_328, expenseCategoryId),
    makeTransaction(state, 'August final bills', '2026-08-28', 'expense', 79_383, expenseCategoryId),
    makeTransaction(state, 'Camilo Car Insurance', '2026-09-01', 'expense', 6_315, expenseCategoryId),
    makeTransaction(state, 'CC Brasil', '2026-09-01', 'expense', 22_500, expenseCategoryId),
    makeTransaction(state, 'Royal London - Life Insurance', '2026-09-02', 'expense', 3_925, expenseCategoryId),
  )
  const cycle = createPlannerCycle(state, '2026-08-01', '2026-08-31')
  const weeks = buildPlanningWeeks(state, cycle.reportRange.start, cycle.reportRange.end, planningReference, 0, 0, cycle.plannerRange)
  const cycleSummary = buildPlannerCycleSummary(weeks)
  const summary = summarizeRange(state, cycle.reportRange.start, cycle.reportRange.end, planningReference)
  const metrics = buildPlannerPeriodMetrics(cycle, weeks, summary.incomeCents, summary.expenseCents, 0, 0)
  return { state, incomeCategoryId, expenseCategoryId, cycle, weeks, cycleSummary, summary, metrics }
}

describe('printable planning reports', () => {
  it('builds seven daily columns and allocates the full savings plan', () => {
    const state = createDemoState()
    const today = new Date(`${todayIso()}T12:00:00`)
    const monthStart = toIsoDate(startOfMonth(today))
    const monthEnd = toIsoDate(endOfMonth(today))
    const plannedSavings = 125_000

    const openingBalance = 300_000
    const weeks = buildPlanningWeeks(state, monthStart, monthEnd, today, plannedSavings, openingBalance)

    expect(weeks.length).toBeGreaterThanOrEqual(4)
    expect(weeks.length).toBeLessThanOrEqual(6)
    expect(weeks.every((week) => week.days.length === 7)).toBe(true)
    expect(weeks.reduce((total, week) => total + week.plannedSavingsCents, 0)).toBe(plannedSavings)
    expect(weeks.every((week) => week.afterSavingsCents === week.remainingCents - week.plannedSavingsCents)).toBe(true)
    expect(weeks[0].openingBalanceCents).toBe(openingBalance)
    expect(weeks.slice(1).every((week, index) => week.openingBalanceCents === weeks[index].closingBalanceCents)).toBe(true)
  })

  it('counts completed transfers into savings during the selected period', () => {
    const state = createDemoState()
    const reportDate = '2026-08-11'
    const savingsTransfer = state.transactions.find((transaction) => transaction.type === 'transfer' && transaction.tags.includes('recurring'))
    if (!savingsTransfer) throw new Error('Demo state must include its recurring savings transfer.')
    savingsTransfer.transactionDate = reportDate
    savingsTransfer.dueDate = reportDate
    savingsTransfer.paidDate = reportDate

    expect(savingsContributedInRange(state, reportDate, reportDate)).toBe(savingsTransfer.amountCents)
  })

  it('includes adjacent August items in the first September planning week and its running balance', () => {
    const { state, incomeCategoryId, expenseCategoryId } = createPlanningState(4)
    state.transactions.push(
      makeTransaction(state, 'August income', '2026-08-27', 'income', 50_000, incomeCategoryId),
      makeTransaction(state, 'August bill', '2026-08-28', 'expense', 10_000, expenseCategoryId),
      makeTransaction(state, 'September bill', '2026-09-01', 'expense', 20_000, expenseCategoryId),
    )

    const [firstWeek] = buildSeptemberPlanner(state)

    expect(firstWeek.start).toBe('2026-08-27')
    expect(firstWeek.end).toBe('2026-09-02')
    expect(firstWeek.days.flatMap((day) => day.items.map((item) => item.title))).toEqual([
      'August income',
      'August bill',
      'September bill',
    ])
    expect(firstWeek.incomeCents).toBe(50_000)
    expect(firstWeek.expenseCents).toBe(30_000)
    expect(firstWeek.days.find((day) => day.date === '2026-08-27')?.closingBalanceCents).toBe(150_000)
    expect(firstWeek.days.find((day) => day.date === '2026-08-28')?.closingBalanceCents).toBe(140_000)
    expect(firstWeek.days.find((day) => day.date === '2026-09-01')?.closingBalanceCents).toBe(120_000)
    expect(firstWeek.closingBalanceCents).toBe(120_000)
  })

  it('keeps the September summary and category totals limited to the exact report range', () => {
    const { state, incomeCategoryId, expenseCategoryId } = createPlanningState(4)
    state.transactions.push(
      makeTransaction(state, 'August income', '2026-08-27', 'income', 50_000, incomeCategoryId),
      makeTransaction(state, 'August bill', '2026-08-28', 'expense', 10_000, expenseCategoryId),
      makeTransaction(state, 'September bill', '2026-09-01', 'expense', 20_000, expenseCategoryId),
    )

    const summary = summarizeRange(state, septemberRange.start, septemberRange.end, planningReference)
    const categories = buildCategoryDistribution(state, septemberRange.start, septemberRange.end, planningReference)

    expect(summary.incomeCents).toBe(0)
    expect(summary.expenseCents).toBe(20_000)
    expect(summary.items.map((item) => item.title)).toEqual(['September bill'])
    expect(categories).toHaveLength(1)
    expect(categories[0].amountCents).toBe(20_000)
  })

  it('carries the closing balance of the adjacent first week into the next week', () => {
    const { state, incomeCategoryId, expenseCategoryId } = createPlanningState(4)
    state.transactions.push(
      makeTransaction(state, 'August income', '2026-08-27', 'income', 50_000, incomeCategoryId),
      makeTransaction(state, 'August bill', '2026-08-28', 'expense', 10_000, expenseCategoryId),
      makeTransaction(state, 'September bill', '2026-09-01', 'expense', 20_000, expenseCategoryId),
      makeTransaction(state, 'Second week bill', '2026-09-03', 'expense', 5_000, expenseCategoryId),
    )

    const weeks = buildSeptemberPlanner(state)

    expect(weeks[0].closingBalanceCents).toBe(120_000)
    expect(weeks[1].openingBalanceCents).toBe(weeks[0].closingBalanceCents)
    expect(weeks[1].closingBalanceCents).toBe(115_000)
  })

  it('carries August closing into September opening instead of recomputing a fresh opening', () => {
    const { state, augustCycle, septemberCycle } = createCarryRegressionState()
    const augustWeeks = buildPlanningWeeks(state, augustCycle.reportRange.start, augustCycle.reportRange.end, planningReference, 0, 8_212, augustCycle.plannerRange)
    const septemberWeeks = buildPlannerWeeksWithCarry(state, augustCycle, septemberCycle, planningReference, 8_212, () => 0)

    expect(augustWeeks.at(-1)?.closingBalanceCents).toBe(9_605)
    expect(septemberWeeks[0].openingBalanceCents).toBe(9_605)
    expect(septemberWeeks[0].closingBalanceCents).toBe(45_651)
    expect(septemberWeeks[0].openingBalanceCents).not.toBe(-52_741)
    expect(septemberWeeks[0].openingBalanceCents + septemberWeeks[0].remainingCents).toBe(45_651)
  })

  it('carries a dragged bill from August into September and recalculates both cycle boundaries', () => {
    const { state, augustCycle, septemberCycle } = createCarryRegressionState()
    const augustBill = buildVisibleItems(state, '2026-08-27', '2026-08-28', planningReference).find((item) => item.title === 'August carry bills')!

    const moved = moveOneOffPlannerItem(state, augustBill, '2026-09-04', '2026-08-08T12:00:00.000Z')
    const augustWeeks = buildPlanningWeeks(moved, augustCycle.reportRange.start, augustCycle.reportRange.end, planningReference, 0, 8_212, augustCycle.plannerRange)
    const septemberWeeks = buildPlannerWeeksWithCarry(moved, augustCycle, septemberCycle, planningReference, 8_212, () => 0)

    expect(augustWeeks.at(-1)?.closingBalanceCents).toBe(118_282)
    expect(septemberWeeks[0].openingBalanceCents).toBe(118_282)
    expect(septemberWeeks[0].closingBalanceCents).toBe(45_651)
    expect(septemberWeeks.flatMap((week) => week.days).flatMap((day) => day.items).some((item) => item.title === 'August carry bills' && item.date === '2026-09-04')).toBe(true)
  })

  it('shows the complete final week while excluding next-month items from the monthly summary', () => {
    const { state, incomeCategoryId, expenseCategoryId } = createPlanningState(1)
    state.transactions.push(
      makeTransaction(state, 'September closing bill', '2026-09-30', 'expense', 20_000, expenseCategoryId),
      makeTransaction(state, 'October income', '2026-10-01', 'income', 30_000, incomeCategoryId),
    )

    const weeks = buildSeptemberPlanner(state)
    const lastWeek = weeks.at(-1)!
    const summary = summarizeRange(state, septemberRange.start, septemberRange.end, planningReference)

    expect(lastWeek.start).toBe('2026-09-28')
    expect(lastWeek.end).toBe('2026-10-04')
    expect(lastWeek.days.find((day) => day.date === '2026-10-01')?.items[0]?.title).toBe('October income')
    expect(lastWeek.incomeCents).toBe(30_000)
    expect(summary.incomeCents).toBe(0)
    expect(summary.expenseCents).toBe(20_000)
    expect(summary.items.map((item) => item.title)).toEqual(['September closing bill'])
  })

  it('shows an adjacent virtual recurrence without materializing or counting it in September', () => {
    const { state, incomeCategoryId } = createPlanningState(4)
    state.recurringRules.push(makeRule(state, 'annual-income', 'Adjacent virtual income', '2026-08-27', 50_000, incomeCategoryId))
    const transactionCount = state.transactions.length

    const [firstWeek] = buildSeptemberPlanner(state)
    const adjacentItems = firstWeek.days.find((day) => day.date === '2026-08-27')!.items
    const summary = summarizeRange(state, septemberRange.start, septemberRange.end, planningReference)

    expect(adjacentItems).toHaveLength(1)
    expect(adjacentItems[0]).toMatchObject({ title: 'Adjacent virtual income', sourceKind: 'recurring' })
    expect(state.transactions).toHaveLength(transactionCount)
    expect(summary.incomeCents).toBe(0)
    expect(summary.items).toHaveLength(0)
  })

  it('uses one physical override for an adjacent recurrence without duplicating it', () => {
    const { state, incomeCategoryId } = createPlanningState(4)
    const rule = makeRule(state, 'annual-income', 'Original virtual income', '2026-08-27', 50_000, incomeCategoryId)
    state.recurringRules.push(rule)
    state.transactions.push(
      makeTransaction(state, 'Adjusted August income', '2026-08-27', 'income', 55_000, incomeCategoryId, rule.id),
    )

    const [firstWeek] = buildSeptemberPlanner(state)
    const adjacentItems = firstWeek.days.find((day) => day.date === '2026-08-27')!.items
    const summary = summarizeRange(state, septemberRange.start, septemberRange.end, planningReference)

    expect(adjacentItems).toHaveLength(1)
    expect(adjacentItems[0]).toMatchObject({ title: 'Adjusted August income', amountCents: 55_000 })
    expect(summary.items).toHaveLength(0)
  })

  it.each([
    { weekStartDay: 1, expectedStart: '2026-08-31', expectedEnd: '2026-10-04' },
    { weekStartDay: 4, expectedStart: '2026-08-27', expectedEnd: '2026-09-30' },
  ])('respects configured week start $weekStartDay when expanding the planner range', ({ weekStartDay, expectedStart, expectedEnd }) => {
    const { state } = createPlanningState(weekStartDay)

    expect(expandPlanningRange(state, septemberRange.start, septemberRange.end)).toEqual({
      start: expectedStart,
      end: expectedEnd,
    })
  })
})

describe('calendar month results and continuous planner cycles', () => {
  it('keeps the August calendar result separate from the strict planner-cycle summary', () => {
    const { summary, cycleSummary, metrics } = createAugustCycleScenario()

    expect(summary.incomeCents).toBe(440_000)
    expect(summary.expenseCents).toBe(405_711)
    expect(metrics.calendarMonthResultCents).toBe(34_289)
    expect(metrics.plannerCycleClosingBalanceCents).toBe(1_549)
    expect(metrics.calendarMonthResultCents).not.toBe(metrics.plannerCycleClosingBalanceCents)
    expect(metrics.calendarMonthProjectedClosingCents).toBe(34_289)
    expect(cycleSummary).toEqual({
      openingBalanceCents: 0,
      incomeCents: 440_000,
      expenseCents: 438_451,
      incomeMinusBillsCents: 1_549,
      savingsAllocationCents: 0,
      closingBalanceCents: 1_549,
    })
    expect(cycleSummary.closingBalanceCents).toBe(
      cycleSummary.openingBalanceCents
      + cycleSummary.incomeCents
      - cycleSummary.expenseCents
      - cycleSummary.savingsAllocationCents,
    )
    expect(Object.values(metrics)).not.toContain(55_235)
  })

  it('carries the prior balance into the final Thursday-Wednesday week and closes it at €15.49', () => {
    const { weeks } = createAugustCycleScenario()
    const finalWeek = weeks.at(-1)!

    expect(finalWeek).toMatchObject({
      start: '2026-08-27',
      end: '2026-09-02',
      openingBalanceCents: 3_672,
      incomeCents: 110_000,
      expenseCents: 112_123,
      closingBalanceCents: 1_549,
    })
    expect(weeks.slice(1).every((week, index) => week.openingBalanceCents === weeks[index].closingBalanceCents)).toBe(true)
  })

  it('starts the next Thursday-Wednesday cycle on 3 September without repeating adjacent days', () => {
    const { state, cycle } = createAugustCycleScenario(4)
    const transactionCount = state.transactions.length
    const nextCycle = movePlannerCycle(state, cycle, 1)
    const previousCycle = movePlannerCycle(state, nextCycle, -1)
    const nextWeeks = buildPlanningWeeks(state, nextCycle.reportRange.start, nextCycle.reportRange.end, planningReference, 0, 0, nextCycle.plannerRange)
    const nextDates = nextWeeks.flatMap((week) => week.days.map((day) => day.date))

    expect(cycle.plannerRange).toEqual({ start: '2026-07-30', end: '2026-09-02' })
    expect(cycle.nextPlannerStart).toBe('2026-09-03')
    expect(nextCycle.plannerRange).toEqual({ start: '2026-09-03', end: '2026-09-30' })
    expect(previousCycle.plannerRange).toEqual(cycle.plannerRange)
    expect(nextDates).not.toContain('2026-09-01')
    expect(nextDates).not.toContain('2026-09-02')
    expect(state.transactions).toHaveLength(transactionCount)
  })

  it('keeps August reports, categories, and monthly item exports limited to 1–31 August', () => {
    const { state, expenseCategoryId, summary } = createAugustCycleScenario()
    const reportItems = buildVisibleItems(state, '2026-08-01', '2026-08-31', planningReference)
    const categories = buildCategoryDistribution(state, '2026-08-01', '2026-08-31', planningReference)

    expect(summary.expenseCents).toBe(405_711)
    expect(summary.remainingCents).toBe(34_289)
    expect(reportItems.some((item) => item.date === '2026-09-01' || item.date === '2026-09-02')).toBe(false)
    expect(categories.find((entry) => entry.categoryId === expenseCategoryId)?.amountCents).toBe(405_711)
  })

  it('creates continuous non-overlapping cycles for a Monday-Sunday week', () => {
    const { state, cycle, metrics } = createAugustCycleScenario(1)
    const nextCycle = movePlannerCycle(state, cycle, 1)
    const currentDates = buildPlanningWeeks(state, cycle.reportRange.start, cycle.reportRange.end, planningReference, 0, 0, cycle.plannerRange)
      .flatMap((week) => week.days.map((day) => day.date))
    const nextDates = buildPlanningWeeks(state, nextCycle.reportRange.start, nextCycle.reportRange.end, planningReference, 0, 0, nextCycle.plannerRange)
      .flatMap((week) => week.days.map((day) => day.date))

    expect(cycle.plannerRange).toEqual({ start: '2026-07-27', end: '2026-09-06' })
    expect(nextCycle.plannerRange).toEqual({ start: '2026-09-07', end: '2026-10-04' })
    expect(nextCycle.plannerRange.start).toBe(cycle.nextPlannerStart)
    expect(currentDates.filter((date) => nextDates.includes(date))).toHaveLength(0)
    expect(metrics.plannerCycleClosingBalanceCents).toBe(1_549)
  })

  it('includes adjacent virtual recurrences once without materializing them in either cycle', () => {
    const { state, expenseCategoryId, cycle } = createAugustCycleScenario(4)
    state.transactions = state.transactions.filter((transaction) => transaction.transactionDate < '2026-09-01')
    state.recurringRules.push(
      makeRule(state, 'virtual-sep-1', 'Virtual September bill', '2026-09-01', 6_315, expenseCategoryId),
      makeRule(state, 'virtual-sep-2', 'Virtual September insurance', '2026-09-02', 3_925, expenseCategoryId),
    )
    const transactionCount = state.transactions.length
    const currentWeeks = buildPlanningWeeks(state, cycle.reportRange.start, cycle.reportRange.end, planningReference, 0, 0, cycle.plannerRange)
    const nextCycle = movePlannerCycle(state, cycle, 1)
    const nextWeeks = buildPlanningWeeks(state, nextCycle.reportRange.start, nextCycle.reportRange.end, planningReference, 0, 0, nextCycle.plannerRange)

    expect(currentWeeks.flatMap((week) => week.days).filter((day) => ['2026-09-01', '2026-09-02'].includes(day.date)).flatMap((day) => day.items)).toHaveLength(2)
    expect(nextWeeks.flatMap((week) => week.days).flatMap((day) => day.items).some((item) => item.recurrenceRuleId?.startsWith('virtual-sep'))).toBe(false)
    expect(state.transactions).toHaveLength(transactionCount)
  })

  it('honours overrides and tombstones across the cycle boundary without resurrecting virtual items', () => {
    const { state, expenseCategoryId, cycle } = createAugustCycleScenario(4)
    state.transactions = state.transactions.filter((transaction) => transaction.transactionDate < '2026-09-01')
    const overrideRule = makeRule(state, 'override-rule', 'Original virtual bill', '2026-09-01', 6_315, expenseCategoryId)
    const cancelledRule = makeRule(state, 'cancelled-rule', 'Cancelled virtual bill', '2026-09-02', 3_925, expenseCategoryId)
    state.recurringRules.push(overrideRule, cancelledRule)
    state.transactions.push(
      { ...makeTransaction(state, 'Adjusted September bill', '2026-09-01', 'expense', 7_000, expenseCategoryId, overrideRule.id), id: 'override' },
      { ...makeTransaction(state, 'Cancelled virtual bill', '2026-09-02', 'expense', 3_925, expenseCategoryId, cancelledRule.id), id: 'tombstone', status: 'cancelled' },
    )
    const currentItems = buildPlanningWeeks(state, cycle.reportRange.start, cycle.reportRange.end, planningReference, 0, 0, cycle.plannerRange)
      .flatMap((week) => week.days).flatMap((day) => day.items)
    const nextCycle = movePlannerCycle(state, cycle, 1)
    const nextItems = buildPlanningWeeks(state, nextCycle.reportRange.start, nextCycle.reportRange.end, planningReference, 0, 0, nextCycle.plannerRange)
      .flatMap((week) => week.days).flatMap((day) => day.items)

    expect(currentItems.filter((item) => item.recurrenceRuleId === overrideRule.id)).toHaveLength(1)
    expect(currentItems.find((item) => item.recurrenceRuleId === overrideRule.id)).toMatchObject({ title: 'Adjusted September bill', amountCents: 7_000 })
    expect(currentItems.some((item) => item.recurrenceRuleId === cancelledRule.id)).toBe(false)
    expect(nextItems.some((item) => [overrideRule.id, cancelledRule.id].includes(item.recurrenceRuleId ?? ''))).toBe(false)
  })
})
