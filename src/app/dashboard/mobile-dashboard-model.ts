import { addDays, differenceInCalendarDays, endOfMonth, startOfMonth } from 'date-fns'
import { buildRollingBalanceProjection, currentSpendableBalance } from '@/domain/cashflow'
import { buildVisibleItems, type SimpleItem } from '@/domain/home'
import type { AppState } from '@/domain/model'
import { buildPlanningWeeks, createPlannerCycle, savingsContributedInRange, type PlanningWeek } from '@/domain/planning'
import { fromIsoDate, toIsoDate } from '@/lib/date'

export type MobileDashboardModel = {
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
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

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
  }
}
