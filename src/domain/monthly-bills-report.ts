import { endOfMonth, startOfMonth } from 'date-fns'
import type { AppState } from './model'
import { buildVisibleItems, type SimpleStatus } from './home'
import { toIsoDate } from '@/lib/date'

export interface MonthlyBillReportItem {
  id: string
  date: string
  title: string
  categoryName: string
  status: SimpleStatus
  amountCents: number
  sourceKind: 'transaction' | 'recurring'
}

export interface MonthlyBillsReport {
  start: string
  end: string
  label: string
  items: MonthlyBillReportItem[]
  totalCents: number
}

export const buildMonthlyBillsReport = (
  state: AppState,
  month: Date,
  referenceDate = new Date(),
): MonthlyBillsReport => {
  const start = toIsoDate(startOfMonth(month))
  const end = toIsoDate(endOfMonth(month))
  const categories = new Map(state.categories.map((category) => [category.id, category.name]))
  const items = buildVisibleItems(state, start, end, referenceDate)
    .filter((item) => item.kind === 'bill')
    .map((item) => ({
      id: item.id,
      date: item.date,
      title: item.title,
      categoryName: categories.get(item.categoryId) ?? 'Uncategorised',
      status: item.status,
      amountCents: item.amountCents,
      sourceKind: item.sourceKind,
    }))
    .sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title))

  return {
    start,
    end,
    label: new Intl.DateTimeFormat(state.settings.locale, { month: 'long', year: 'numeric' }).format(month),
    items,
    totalCents: items.reduce((total, item) => total + item.amountCents, 0),
  }
}
