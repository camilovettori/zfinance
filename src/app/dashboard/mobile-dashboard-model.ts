import { addDays, differenceInCalendarDays, endOfMonth, getDaysInMonth, startOfMonth } from 'date-fns'
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

export type MobileDashboardModel = {
  // existing fields, unchanged — MobileDashboard.tsx still reads these
  todayIso: string
  tomorrowIso: string
  tomorrowLabel: string
  availableNowCents: number
  afterTomorrowCents: number
  tomorrowItems: SimpleItem[]
  tomorrowIncomingCents: number
  tomorrowDueCents: number
  nextIncome: {
    date: string
    label: string
    daysAway: number
    items: SimpleItem[]
    totalCents: number
  } | null
  currentWeek: PlanningWeek
  insight: 'nothing-tomorrow' | 'tomorrow-covered' | 'week-left' | 'week-short'

  // Act 1 — where I stand
  totalOwedCents: number
  netWorthCents: number
  safeToSpendCents: number
  safeToSpendUntilIso: string
  safeToSpendUntilLabel: string
  runwayDays: number
  runwayIsInfinite: boolean

  // Act 2 — what comes next
  horizon: MoneyEvent[]
  lowPointCents: number
  lowPointDateIso: string | null

  // Act 3 — where I'm heading
  debt: DebtSummary
  goals: Array<{
    id: string
    name: string
    currentCents: number
    targetCents: number
    percent: number
    targetDate?: string
    monthsToTarget: number | null
  }>

  // narrative
  headline: { template: string; values: Record<string, number | string> }
  tone: 'good' | 'tight' | 'warning'
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

function buildHorizon(state: AppState, todayIso: string, horizonEndIso: string, availableNowCents: number, referenceDate: Date): MoneyEvent[] {
  const items = buildVisibleItems(state, todayIso, horizonEndIso, referenceDate).filter((item) => item.status !== 'completed')
  const start = fromIsoDate(todayIso)
  const end = fromIsoDate(horizonEndIso)
  const dayCount = Math.min(14, differenceInCalendarDays(end, start) + 1)
  const tomorrowIso = toIsoDate(addDays(start, 1))

  let runningBalance = availableNowCents
  const days: MoneyEvent[] = []
  for (let index = 0; index < dayCount; index += 1) {
    const date = addDays(start, index)
    const dateIso = toIsoDate(date)
    const dayItems = items.filter((item) => item.date === dateIso)
    const incomeCents = sum(dayItems.filter((item) => item.kind === 'income').map((item) => item.amountCents))
    const billsCents = sum(dayItems.filter((item) => item.kind === 'bill').map((item) => item.amountCents))
    const netCents = incomeCents - billsCents
    runningBalance += netCents
    const dayLabel = dateIso === todayIso ? 'Today' : dateIso === tomorrowIso ? 'Tomorrow'
      : new Intl.DateTimeFormat(state.settings.locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(date)

    days.push({
      date: dateIso,
      dayLabel,
      isToday: dateIso === todayIso,
      items: dayItems,
      incomeCents,
      billsCents,
      netCents,
      balanceAfterCents: runningBalance,
      isLowPoint: false,
      isNegative: runningBalance < 0,
    })
  }

  let lowIndex = 0
  for (let index = 1; index < days.length; index += 1) {
    if (days[index].balanceAfterCents < days[lowIndex].balanceAfterCents) lowIndex = index
  }
  if (days[lowIndex]) days[lowIndex] = { ...days[lowIndex], isLowPoint: true }

  return days
}

export function buildMobileDashboardModel(state: AppState, referenceDate = new Date()): MobileDashboardModel {
  const localToday = fromIsoDate(toIsoDate(referenceDate))
  const today = toIsoDate(localToday)
  const tomorrowDate = addDays(localToday, 1)
  const tomorrow = toIsoDate(tomorrowDate)
  const availableNowCents = currentSpendableBalance(state)
  const tomorrowItems = buildVisibleItems(state, tomorrow, tomorrow, referenceDate)
    .filter((item) => item.status !== 'completed')
  const tomorrowIncomingCents = sum(tomorrowItems.filter((item) => item.kind === 'income').map((item) => item.amountCents))
  const tomorrowDueCents = sum(tomorrowItems.filter((item) => item.kind === 'bill').map((item) => item.amountCents))

  const upcomingIncomes = buildVisibleItems(state, today, toIsoDate(addDays(localToday, 366)), referenceDate)
    .filter((item) => item.kind === 'income' && item.status !== 'completed')
  const nextIncomeDate = upcomingIncomes[0]?.date
  const nextIncomeItems = nextIncomeDate ? upcomingIncomes.filter((item) => item.date === nextIncomeDate) : []
  const nextIncome = nextIncomeDate ? {
    date: nextIncomeDate,
    label: new Intl.DateTimeFormat(state.settings.locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(fromIsoDate(nextIncomeDate)),
    daysAway: differenceInCalendarDays(fromIsoDate(nextIncomeDate), localToday),
    items: nextIncomeItems,
    totalCents: sum(nextIncomeItems.map((item) => item.amountCents)),
  } : null

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

  const insight = tomorrowItems.length === 0
    ? 'nothing-tomorrow'
    : nextIncome?.date === tomorrow && tomorrowDueCents > 0 && nextIncome.totalCents >= tomorrowDueCents
      ? 'tomorrow-covered'
      : currentWeek.closingBalanceCents >= 0
        ? 'week-left'
        : 'week-short'

  const debt = buildDebtSummary(state, referenceDate)
  const safeToSpendUntilIso = nextIncome?.date ?? toIsoDate(addDays(localToday, 7))
  const horizon = buildHorizon(state, today, safeToSpendUntilIso, availableNowCents, referenceDate)
  const lowPointEntry = horizon.find((day) => day.isLowPoint) ?? horizon[0]

  const safeToSpendUntilDate = fromIsoDate(safeToSpendUntilIso)
  const untilWithinWeek = differenceInCalendarDays(safeToSpendUntilDate, localToday) <= 7
  const untilWeekday = new Intl.DateTimeFormat(state.settings.locale, { weekday: 'long' }).format(safeToSpendUntilDate)
  const safeToSpendUntilLabel = untilWithinWeek ? `until ${untilWeekday}` : `until next ${untilWeekday}`

  const horizonBillsCents = sum(horizon.map((day) => day.billsCents))
  const monthlyGoalContributionsCents = sum(state.goals.filter((goal) => !goal.archived).map((goal) => goal.monthlyContributionCents))
  const horizonDays = differenceInCalendarDays(safeToSpendUntilDate, localToday) + 1
  const savingsAllocationCents = Math.round(monthlyGoalContributionsCents * horizonDays / getDaysInMonth(referenceDate))
  const safeToSpendCents = availableNowCents - horizonBillsCents - savingsAllocationCents

  const runwayWindow = buildRollingBalanceProjection(state, today, toIsoDate(addDays(localToday, 89)), referenceDate)
  const firstNegativeIndex = runwayWindow.days.findIndex((day) => day.closingBalanceCents < 0)
  const runwayIsInfinite = firstNegativeIndex === -1
  const runwayDays = runwayIsInfinite ? 90 : firstNegativeIndex

  return {
    todayIso: today,
    tomorrowIso: tomorrow,
    tomorrowLabel: new Intl.DateTimeFormat(state.settings.locale, { weekday: 'long', day: 'numeric', month: 'short' }).format(tomorrowDate),
    availableNowCents,
    afterTomorrowCents: availableNowCents + tomorrowIncomingCents - tomorrowDueCents,
    tomorrowItems,
    tomorrowIncomingCents,
    tomorrowDueCents,
    nextIncome,
    currentWeek,
    insight,
    totalOwedCents: debt.totalOwedCents,
    netWorthCents: availableNowCents - debt.totalOwedCents,
    safeToSpendCents,
    safeToSpendUntilIso,
    safeToSpendUntilLabel,
    runwayDays,
    runwayIsInfinite,
    horizon,
    lowPointCents: lowPointEntry?.balanceAfterCents ?? 0,
    lowPointDateIso: lowPointEntry?.date ?? null,
    debt,
    goals: [],
    headline: { template: '', values: {} },
    tone: 'good',
  }
}
