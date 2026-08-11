import { addDays, differenceInCalendarDays, endOfMonth, startOfMonth } from 'date-fns'
import { buildRollingBalanceProjection, currentSpendableBalance } from '@/domain/cashflow'
import { buildDebtSummary, type DebtSummary } from '@/domain/debt'
import { buildVisibleItems, type SimpleItem } from '@/domain/home'
import type { AppState } from '@/domain/model'
import { buildPlanningWeeks, createPlannerCycle, savingsContributedInRange, type PlanningWeek } from '@/domain/planning'
import { fromIsoDate, toIsoDate } from '@/lib/date'

export type MoneyEvent = {
  date: string
  dayLabel: string
  isToday: boolean
  items: SimpleItem[]
  incomeCents: number
  billsCents: number
  netCents: number
  balanceAfterCents: number
  isLowPoint: boolean
  isNegative: boolean
}

export type HeadlineParts = {
  template: string
  values: Record<string, number | string>
}

export type GoalSummary = {
  id: string
  name: string
  currentCents: number
  targetCents: number
  percent: number
  targetDate?: string
  monthsToTarget: number | null
}

export type MobileDashboardModel = {
  todayIso: string
  todayLabel: string
  availableNowCents: number
  totalOwedCents: number
  netWorthCents: number
  safeToSpendCents: number
  safeToSpendUntilIso: string
  safeToSpendUntilLabel: string
  runwayDays: number
  runwayIsInfinite: boolean
  horizon: MoneyEvent[]
  nextIncome: {
    date: string
    label: string
    daysAway: number
    items: SimpleItem[]
    totalCents: number
  } | null
  lowPointCents: number
  lowPointDateIso: string | null
  debt: DebtSummary
  goals: GoalSummary[]
  headline: HeadlineParts
  tone: 'good' | 'tight' | 'warning'
  currentWeek: PlanningWeek
}

type LegacyMobileDashboardFields = {
  tomorrowIso: string
  tomorrowLabel: string
  afterTomorrowCents: number
  tomorrowItems: SimpleItem[]
  tomorrowIncomingCents: number
  tomorrowDueCents: number
  insight: 'nothing-tomorrow' | 'tomorrow-covered' | 'week-left' | 'week-short'
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

const groupByDate = (items: SimpleItem[]) => {
  const grouped = new Map<string, SimpleItem[]>()
  for (const item of items) grouped.set(item.date, [...grouped.get(item.date) ?? [], item])
  return grouped
}

function buildTimeline(
  state: AppState,
  startIso: string,
  endIso: string,
  availableNowCents: number,
  referenceDate: Date,
  maxEntries: number,
): MoneyEvent[] {
  const start = fromIsoDate(startIso)
  const requestedEnd = fromIsoDate(endIso)
  const dayCount = Math.min(maxEntries, differenceInCalendarDays(requestedEnd, start) + 1)
  const actualEndIso = toIsoDate(addDays(start, Math.max(0, dayCount - 1)))
  const itemsByDate = groupByDate(
    buildVisibleItems(state, startIso, actualEndIso, referenceDate).filter((item) => item.status !== 'completed'),
  )

  let runningBalance = availableNowCents
  const events = Array.from({ length: dayCount }, (_, index): MoneyEvent => {
    const date = addDays(start, index)
    const dateIso = toIsoDate(date)
    const items = itemsByDate.get(dateIso) ?? []
    const incomeCents = sum(items.filter((item) => item.kind === 'income').map((item) => item.amountCents))
    const billsCents = sum(items.filter((item) => item.kind === 'bill').map((item) => item.amountCents))
    const netCents = incomeCents - billsCents
    runningBalance += netCents
    return {
      date: dateIso,
      dayLabel: index === 0
        ? 'Today'
        : index === 1
          ? 'Tomorrow'
          : new Intl.DateTimeFormat(state.settings.locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(date),
      isToday: index === 0,
      items,
      incomeCents,
      billsCents,
      netCents,
      balanceAfterCents: runningBalance,
      isLowPoint: false,
      isNegative: runningBalance < 0,
    }
  })

  if (events.length) {
    let lowPointIndex = 0
    for (let index = 1; index < events.length; index += 1) {
      if (events[index].balanceAfterCents < events[lowPointIndex].balanceAfterCents) lowPointIndex = index
    }
    events[lowPointIndex] = { ...events[lowPointIndex], isLowPoint: true }
  }
  return events
}

function buildCurrentPlannerWeek(state: AppState, localToday: Date, referenceDate: Date) {
  const today = toIsoDate(localToday)
  const reportStart = toIsoDate(startOfMonth(localToday))
  const reportEnd = toIsoDate(endOfMonth(localToday))
  const cycle = createPlannerCycle(state, reportStart, reportEnd)
  const plannedMonthlySavings = sum(state.goals.filter((goal) => !goal.archived).map((goal) => goal.monthlyContributionCents))
  const savingsForCycle = Math.max(
    plannedMonthlySavings,
    savingsContributedInRange(state, cycle.plannerRange.start, cycle.plannerRange.end),
  )
  const openingBalanceCents = buildRollingBalanceProjection(
    state,
    cycle.plannerRange.start,
    cycle.plannerRange.end,
    referenceDate,
  ).openingBalanceCents
  const planningWeeks = buildPlanningWeeks(
    state,
    cycle.reportRange.start,
    cycle.reportRange.end,
    referenceDate,
    savingsForCycle,
    openingBalanceCents,
    cycle.plannerRange,
  )
  const currentWeek = planningWeeks.find((week) => today >= week.start && today <= week.end) ?? planningWeeks[0]
  if (!currentWeek) throw new Error('The current Planner cycle did not produce a week.')
  return currentWeek
}

export function buildMobileDashboardModel(state: AppState, referenceDate = new Date()) {
  const localToday = fromIsoDate(toIsoDate(referenceDate))
  const todayIso = toIsoDate(localToday)
  const availableNowCents = currentSpendableBalance(state)
  const upcomingItems = buildVisibleItems(state, todayIso, toIsoDate(addDays(localToday, 366)), referenceDate)
    .filter((item) => item.status !== 'completed')
  const upcomingIncomes = upcomingItems.filter((item) => item.kind === 'income')
  const nextIncomeDate = upcomingIncomes[0]?.date
  const nextIncomeItems = nextIncomeDate ? upcomingIncomes.filter((item) => item.date === nextIncomeDate) : []
  const nextIncome = nextIncomeDate ? {
    date: nextIncomeDate,
    label: new Intl.DateTimeFormat(state.settings.locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(fromIsoDate(nextIncomeDate)),
    daysAway: differenceInCalendarDays(fromIsoDate(nextIncomeDate), localToday),
    items: nextIncomeItems,
    totalCents: sum(nextIncomeItems.map((item) => item.amountCents)),
  } : null
  const safeToSpendUntilIso = nextIncomeDate ?? toIsoDate(addDays(referenceDate, 7))
  const safeToSpendUntilDate = fromIsoDate(safeToSpendUntilIso)
  const daysUntilIncome = differenceInCalendarDays(safeToSpendUntilDate, localToday)
  const untilWeekday = new Intl.DateTimeFormat(state.settings.locale, { weekday: 'long' }).format(safeToSpendUntilDate)
  const safeToSpendUntilLabel = daysUntilIncome === 0
    ? 'until today'
    : daysUntilIncome < 7
      ? `until ${untilWeekday}`
      : `until next ${untilWeekday}`

  const billsUntilPayday = sum(upcomingItems
    .filter((item) => item.kind === 'bill' && item.date <= safeToSpendUntilIso)
    .map((item) => item.amountCents))
  const plannedMonthlySavings = sum(state.goals.filter((goal) => !goal.archived).map((goal) => goal.monthlyContributionCents))
  const horizonDays = daysUntilIncome + 1
  const savingsAllocationCents = Math.round(plannedMonthlySavings * (horizonDays / 30))
  const safeToSpendCents = availableNowCents - billsUntilPayday - savingsAllocationCents

  const horizon = buildTimeline(state, todayIso, safeToSpendUntilIso, availableNowCents, referenceDate, 14)
  const lowPoint = horizon.find((event) => event.isLowPoint) ?? null

  const runway = buildTimeline(
    state,
    todayIso,
    toIsoDate(addDays(localToday, 89)),
    availableNowCents,
    referenceDate,
    90,
  )
  const firstNegativeRunwayIndex = runway.findIndex((event) => event.isNegative)
  const runwayIsInfinite = firstNegativeRunwayIndex === -1
  const runwayDays = runwayIsInfinite ? 90 : firstNegativeRunwayIndex

  const debt = buildDebtSummary(state, referenceDate)
  const goals: GoalSummary[] = state.goals.filter((goal) => !goal.archived).map((goal) => ({
    id: goal.id,
    name: goal.name,
    currentCents: goal.currentCents,
    targetCents: goal.targetCents,
    percent: goal.targetCents > 0
      ? Math.min(100, Math.max(0, Math.round(goal.currentCents / goal.targetCents * 100)))
      : 100,
    targetDate: goal.targetDate,
    monthsToTarget: goal.monthlyContributionCents > 0 && goal.currentCents < goal.targetCents
      ? Math.ceil((goal.targetCents - goal.currentCents) / goal.monthlyContributionCents)
      : null,
  }))

  let tone: MobileDashboardModel['tone'] = 'good'
  let headline: HeadlineParts
  if ((lowPoint?.balanceAfterCents ?? 0) < 0) {
    tone = 'warning'
    headline = {
      template: 'Short by {amount} on {day} — {billTotal} of bills before your next payday.',
      values: {
        amount: Math.abs(lowPoint!.balanceAfterCents),
        day: lowPoint!.dayLabel,
        billTotal: sum(horizon.map((event) => event.billsCents)),
      },
    }
  } else if (safeToSpendCents < availableNowCents * 0.10) {
    tone = 'tight'
    headline = {
      template: "{amount} to spend {until}. It's tight but it holds.",
      values: { amount: safeToSpendCents, until: safeToSpendUntilLabel },
    }
  } else if (!debt.isDebtFree && debt.payoffDateIso !== null) {
    headline = {
      template: '{amount} to spend {until}. Debt-free by {payoffDate} at this pace.',
      values: { amount: safeToSpendCents, until: safeToSpendUntilLabel, payoffDate: debt.payoffDateIso },
    }
  } else {
    const advancedGoal = goals.find((goal) => goal.percent >= 75)
    headline = advancedGoal ? {
      template: '{amount} to spend {until}. {goalName} is {goalPercent}% there.',
      values: {
        amount: safeToSpendCents,
        until: safeToSpendUntilLabel,
        goalName: advancedGoal.name,
        goalPercent: String(advancedGoal.percent),
      },
    } : {
      template: '{amount} to spend {until}.',
      values: { amount: safeToSpendCents, until: safeToSpendUntilLabel },
    }
  }

  const currentWeek = buildCurrentPlannerWeek(state, localToday, referenceDate)
  const model: MobileDashboardModel = {
    todayIso,
    todayLabel: new Intl.DateTimeFormat(state.settings.locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(localToday),
    availableNowCents,
    totalOwedCents: debt.totalOwedCents,
    netWorthCents: availableNowCents - debt.totalOwedCents,
    safeToSpendCents,
    safeToSpendUntilIso,
    safeToSpendUntilLabel,
    runwayDays,
    runwayIsInfinite,
    horizon,
    nextIncome,
    lowPointCents: lowPoint?.balanceAfterCents ?? 0,
    lowPointDateIso: lowPoint?.date ?? null,
    debt,
    goals,
    headline,
    tone,
    currentWeek,
  }

  const tomorrowIso = toIsoDate(addDays(localToday, 1))
  const tomorrowEvent = horizon.find((event) => event.date === tomorrowIso)
  const tomorrowItems = tomorrowEvent?.items ?? []
  const legacy: LegacyMobileDashboardFields = {
    tomorrowIso,
    tomorrowLabel: new Intl.DateTimeFormat(state.settings.locale, { weekday: 'long', day: 'numeric', month: 'short' }).format(fromIsoDate(tomorrowIso)),
    afterTomorrowCents: tomorrowEvent?.balanceAfterCents ?? availableNowCents,
    tomorrowItems,
    tomorrowIncomingCents: tomorrowEvent?.incomeCents ?? 0,
    tomorrowDueCents: tomorrowEvent?.billsCents ?? 0,
    insight: tomorrowItems.length === 0
      ? 'nothing-tomorrow'
      : nextIncome?.date === tomorrowIso && (tomorrowEvent?.billsCents ?? 0) > 0 && nextIncome.totalCents >= (tomorrowEvent?.billsCents ?? 0)
        ? 'tomorrow-covered'
        : currentWeek.closingBalanceCents >= 0
          ? 'week-left'
          : 'week-short',
  }
  return Object.assign(model, legacy)
}
