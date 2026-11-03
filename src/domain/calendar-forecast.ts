import { endOfMonth, endOfYear, startOfMonth, addMonths } from 'date-fns'
import { buildRollingBalanceProjection, currentSpendableBalance } from './cashflow'
import { savingsContributedInRange } from './planning'
import type { AppState } from './model'
import { toIsoDate } from '@/lib/date'

export function buildCalendarForecast(state: AppState, month: Date, referenceDate = new Date()) {
  const today = toIsoDate(referenceDate)
  const monthlySavings = state.goals.filter((goal) => !goal.archived).reduce((total, goal) => total + goal.monthlyContributionCents, 0)
  const endpoint = (end: Date) => {
    const date = toIsoDate(end)
    const rangeStart = date < today ? date : today
    let remainingSavings = 0
    for (let cursor = startOfMonth(referenceDate); toIsoDate(endOfMonth(cursor)) <= date; cursor = addMonths(cursor, 1)) {
      remainingSavings += Math.max(0, monthlySavings - savingsContributedInRange(state, toIsoDate(cursor), toIsoDate(endOfMonth(cursor))))
    }
    return { date, balanceCents: buildRollingBalanceProjection(state, rangeStart, date, referenceDate).closingBalanceCents - remainingSavings }
  }
  return {
    asOf: today,
    availableNowCents: currentSpendableBalance(state),
    monthEnd: endpoint(endOfMonth(month)),
    yearEnd: endpoint(endOfYear(month)),
  }
}
