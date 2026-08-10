import { addDays, addMonths, endOfMonth, endOfWeek, isAfter, startOfMonth, startOfWeek } from 'date-fns'
import { buildVisibleItems, type SimpleItem } from './home'
import type { AppState } from './model'
import { fromIsoDate, toIsoDate } from '@/lib/date'

export type PlanningDay = {
  date: string
  label: string
  inPeriod: boolean
  items: SimpleItem[]
  incomeCents: number
  expenseCents: number
  remainingCents: number
  closingBalanceCents: number
}

export type PlanningWeek = {
  start: string
  end: string
  label: string
  days: PlanningDay[]
  incomeCents: number
  expenseCents: number
  remainingCents: number
  plannedSavingsCents: number
  afterSavingsCents: number
  openingBalanceCents: number
  closingBeforeSavingsCents: number
  closingBalanceCents: number
}

export type PlanningRange = {
  start: string
  end: string
}

export type PlannerCycle = {
  reportRange: PlanningRange
  plannerRange: PlanningRange
  nextPlannerStart: string
}

export type PlannerPeriodMetrics = PlannerCycle & {
  calendarMonthResultCents: number
  calendarMonthProjectedClosingCents: number
  plannerCycleClosingBalanceCents: number
}

export type PlannerCycleSummary = {
  openingBalanceCents: number
  incomeCents: number
  expenseCents: number
  incomeMinusBillsCents: number
  savingsAllocationCents: number
  closingBalanceCents: number
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

export function expandPlanningRange(state: AppState, startIso: string, endIso: string): PlanningRange {
  const weekStartsOn = state.settings.weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6
  return {
    start: toIsoDate(startOfWeek(fromIsoDate(startIso), { weekStartsOn })),
    end: toIsoDate(endOfWeek(fromIsoDate(endIso), { weekStartsOn })),
  }
}

const dayAfter = (dateIso: string) => toIsoDate(addDays(fromIsoDate(dateIso), 1))
const dayBefore = (dateIso: string) => toIsoDate(addDays(fromIsoDate(dateIso), -1))

export function createPlannerCycle(state: AppState, reportStart: string, reportEnd: string): PlannerCycle {
  const plannerRange = expandPlanningRange(state, reportStart, reportEnd)
  return {
    reportRange: { start: reportStart, end: reportEnd },
    plannerRange,
    nextPlannerStart: dayAfter(plannerRange.end),
  }
}

export function movePlannerCycle(state: AppState, current: PlannerCycle, direction: -1 | 1): PlannerCycle {
  const referenceMonth = addMonths(fromIsoDate(current.reportRange.start), direction)
  const reportRange = {
    start: toIsoDate(startOfMonth(referenceMonth)),
    end: toIsoDate(endOfMonth(referenceMonth)),
  }
  const expandedRange = expandPlanningRange(state, reportRange.start, reportRange.end)
  const plannerRange = direction === 1
    ? { start: dayAfter(current.plannerRange.end), end: expandedRange.end }
    : { start: expandedRange.start, end: dayBefore(current.plannerRange.start) }
  return { reportRange, plannerRange, nextPlannerStart: dayAfter(plannerRange.end) }
}

export function buildPlannerPeriodMetrics(
  cycle: PlannerCycle,
  planningWeeks: PlanningWeek[],
  incomeCents: number,
  expenseCents: number,
  calendarMonthOpeningBalanceCents: number,
  savingsCashOutflowCents: number,
): PlannerPeriodMetrics {
  const calendarMonthResultCents = incomeCents - expenseCents
  return {
    ...cycle,
    calendarMonthResultCents,
    calendarMonthProjectedClosingCents:
      calendarMonthOpeningBalanceCents + calendarMonthResultCents - savingsCashOutflowCents,
    plannerCycleClosingBalanceCents: planningWeeks.at(-1)?.closingBalanceCents ?? calendarMonthOpeningBalanceCents,
  }
}

export function buildPlannerCycleSummary(planningWeeks: PlanningWeek[]): PlannerCycleSummary {
  const incomeCents = sum(planningWeeks.map((week) => week.incomeCents))
  const expenseCents = sum(planningWeeks.map((week) => week.expenseCents))
  const savingsAllocationCents = sum(planningWeeks.map((week) => week.plannedSavingsCents))
  return {
    openingBalanceCents: planningWeeks[0]?.openingBalanceCents ?? 0,
    incomeCents,
    expenseCents,
    incomeMinusBillsCents: incomeCents - expenseCents,
    savingsAllocationCents,
    closingBalanceCents: planningWeeks.at(-1)?.closingBalanceCents ?? 0,
  }
}

export function buildPlanningWeeks(
  state: AppState,
  startIso: string,
  endIso: string,
  referenceDate: Date,
  plannedSavingsCents: number,
  openingBalanceCents = 0,
  planningRangeOverride?: PlanningRange,
): PlanningWeek[] {
  const planningRange = planningRangeOverride ?? expandPlanningRange(state, startIso, endIso)
  const gridStart = fromIsoDate(planningRange.start)
  const gridEnd = fromIsoDate(planningRange.end)
  const items = buildVisibleItems(state, planningRange.start, planningRange.end, referenceDate)
  const weeks: PlanningWeek[] = []

  for (let weekStart = gridStart; !isAfter(weekStart, gridEnd); weekStart = addDays(weekStart, 7)) {
    const days = Array.from({ length: 7 }, (_, index): PlanningDay => {
      const date = addDays(weekStart, index)
      const dateIso = toIsoDate(date)
      const dayItems = items.filter((item) => item.date === dateIso)
      const incomeCents = sum(dayItems.filter((item) => item.kind === 'income').map((item) => item.amountCents))
      const expenseCents = sum(dayItems.filter((item) => item.kind === 'bill').map((item) => item.amountCents))
      return {
        date: dateIso,
        label: new Intl.DateTimeFormat(state.settings.locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(date),
        inPeriod: dateIso >= startIso && dateIso <= endIso,
        items: dayItems,
        incomeCents,
        expenseCents,
        remainingCents: incomeCents - expenseCents,
        closingBalanceCents: 0,
      }
    })
    const incomeCents = sum(days.map((day) => day.incomeCents))
    const expenseCents = sum(days.map((day) => day.expenseCents))
    const end = addDays(weekStart, 6)
    weeks.push({
      start: toIsoDate(weekStart),
      end: toIsoDate(end),
      label: `${new Intl.DateTimeFormat(state.settings.locale, { day: 'numeric', month: 'short' }).format(weekStart)} – ${new Intl.DateTimeFormat(state.settings.locale, { day: 'numeric', month: 'short' }).format(end)}`,
      days,
      incomeCents,
      expenseCents,
      remainingCents: incomeCents - expenseCents,
      plannedSavingsCents: 0,
      afterSavingsCents: incomeCents - expenseCents,
      openingBalanceCents: 0,
      closingBeforeSavingsCents: 0,
      closingBalanceCents: 0,
    })
  }

  const activeDayCounts = weeks.map((week) => week.days.filter((day) => day.inPeriod).length)
  const activeDays = sum(activeDayCounts)
  let allocatedSavings = 0
  let carriedBalance = openingBalanceCents
  return weeks.map((week, index) => {
    const isLast = index === weeks.length - 1
    const weekSavings = isLast
      ? plannedSavingsCents - allocatedSavings
      : Math.round(plannedSavingsCents * (activeDayCounts[index] / Math.max(1, activeDays)))
    allocatedSavings += weekSavings
    let dayBalance = carriedBalance
    const days = week.days.map((day) => {
      dayBalance += day.remainingCents
      return { ...day, closingBalanceCents: dayBalance }
    })
    const closingBeforeSavingsCents = dayBalance
    const closingBalanceCents = closingBeforeSavingsCents - weekSavings
    const weekOpeningBalanceCents = carriedBalance
    carriedBalance = closingBalanceCents
    return {
      ...week,
      days,
      plannedSavingsCents: weekSavings,
      afterSavingsCents: week.remainingCents - weekSavings,
      openingBalanceCents: weekOpeningBalanceCents,
      closingBeforeSavingsCents,
      closingBalanceCents,
    }
  })
}

export function buildPlannerWeeksWithCarry(
  state: AppState,
  anchorCycle: PlannerCycle,
  targetCycle: PlannerCycle,
  referenceDate: Date,
  anchorOpeningBalanceCents: number,
  plannedSavingsForCycle: (cycle: PlannerCycle) => number,
): PlanningWeek[] {
  const isTargetAtOrAfterAnchor =
    targetCycle.reportRange.start >= anchorCycle.reportRange.start &&
    targetCycle.reportRange.end >= anchorCycle.reportRange.end

  if (!isTargetAtOrAfterAnchor) {
    return buildPlanningWeeks(
      state,
      targetCycle.reportRange.start,
      targetCycle.reportRange.end,
      referenceDate,
      plannedSavingsForCycle(targetCycle),
      anchorOpeningBalanceCents,
      targetCycle.plannerRange,
    )
  }

  let currentCycle = anchorCycle
  let currentWeeks = buildPlanningWeeks(
    state,
    currentCycle.reportRange.start,
    currentCycle.reportRange.end,
    referenceDate,
    plannedSavingsForCycle(currentCycle),
    anchorOpeningBalanceCents,
    currentCycle.plannerRange,
  )

  while (
    currentCycle.reportRange.start !== targetCycle.reportRange.start ||
    currentCycle.reportRange.end !== targetCycle.reportRange.end
  ) {
    currentCycle = movePlannerCycle(state, currentCycle, 1)
    const carriedOpeningBalance = currentWeeks.at(-1)?.closingBalanceCents ?? anchorOpeningBalanceCents
    currentWeeks = buildPlanningWeeks(
      state,
      currentCycle.reportRange.start,
      currentCycle.reportRange.end,
      referenceDate,
      plannedSavingsForCycle(currentCycle),
      carriedOpeningBalance,
      currentCycle.plannerRange,
    )
  }

  return currentWeeks
}

export function savingsContributedInRange(state: AppState, startIso: string, endIso: string) {
  const savingsAccountIds = new Set(state.accounts.filter((account) => account.type === 'savings').map((account) => account.id))
  return state.transactions
    .filter((transaction) => transaction.transactionDate >= startIso && transaction.transactionDate <= endIso)
    .filter((transaction) => ['paid', 'received'].includes(transaction.status))
    .filter((transaction) =>
      transaction.type === 'transfer' &&
      (Boolean(transaction.counterpartyAccountId && savingsAccountIds.has(transaction.counterpartyAccountId)) || transaction.tags.includes('savings')),
    )
    .reduce((total, transaction) => total + transaction.amountCents, 0)
}
