import { addDays, addMonths, endOfMonth, endOfWeek, isAfter, isBefore, isSameDay, startOfMonth, startOfWeek } from 'date-fns'
import type { AppState, RecurrenceFrequency, RecurringRule, Transaction } from './model'
import { fromIsoDate, monthKey, toIsoDate } from '@/lib/date'

export type SimpleKind = 'income' | 'bill'
export type SimpleStatus = 'planned' | 'completed' | 'overdue'

export interface SimpleItem {
  id: string
  sourceId: string
  sourceKind: 'transaction' | 'recurring'
  kind: SimpleKind
  title: string
  amountCents: number
  date: string
  dayLabel: string
  status: SimpleStatus
  categoryId: string
  personId?: string
  notes?: string
  transactionId?: string
  recurrenceRuleId?: string
  editable: boolean
}

export interface WeekWindow {
  start: string
  end: string
  label: string
}

export interface WeekSnapshot extends WeekWindow {
  incomeCents: number
  expenseCents: number
  remainingCents: number
  availableCents: number
  message: string
  items: SimpleItem[]
  incomeItems: SimpleItem[]
  billItems: SimpleItem[]
  topCategories: Array<{ categoryId: string; categoryName: string; amountCents: number }>
}

export interface WeekPreview extends WeekWindow {
  incomeCents: number
  expenseCents: number
  remainingCents: number
}

export interface CalendarDay {
  date: string
  dayLabel: string
  inMonth: boolean
  incomeCents: number
  expenseCents: number
  pendingCount: number
  completedCount: number
  items: SimpleItem[]
}

export interface RangeSummary {
  start: string
  end: string
  label: string
  incomeCents: number
  expenseCents: number
  remainingCents: number
  availableCents: number
  completedIncomeCents: number
  completedExpenseCents: number
  items: SimpleItem[]
  topCategories: Array<{ categoryId: string; categoryName: string; amountCents: number }>
  message: string
}

export interface TrendPoint {
  month: string
  label: string
  incomeCents: number
  expenseCents: number
  remainingCents: number
}

export interface CategoryPoint {
  categoryId: string
  categoryName: string
  amountCents: number
}

const currencyFormatter = (locale: string, currency: string) =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  })

const weekdayFormatter = (locale: string) =>
  new Intl.DateTimeFormat(locale, {
    weekday: 'short',
  })

const monthFormatter = (locale: string) =>
  new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  })

const shortMonthFormatter = (locale: string) =>
  new Intl.DateTimeFormat(locale, {
    month: 'short',
  })

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

const activeTransaction = (transaction: Transaction) => transaction.status !== 'cancelled'

const transactionResolvedStatus = (transaction: Transaction, referenceDate: Date): SimpleStatus => {
  if (transaction.status === 'paid' || transaction.status === 'received') {
    return 'completed'
  }

  const dueDate = transaction.dueDate ? fromIsoDate(transaction.dueDate) : fromIsoDate(transaction.transactionDate)
  if (transaction.status === 'overdue' || isBefore(dueDate, referenceDate)) {
    return 'overdue'
  }

  return 'planned'
}

const itemKindFromTransaction = (transaction: Transaction): SimpleKind | null => {
  if (transaction.type === 'income') {
    return 'income'
  }

  if (transaction.type === 'expense') {
    return 'bill'
  }

  return null
}

const getCategory = (state: AppState, categoryId: string) => state.categories.find((category) => category.id === categoryId)

const kindFromCategory = (state: AppState, categoryId: string): SimpleKind => {
  const category = getCategory(state, categoryId)
  return category?.group === 'Receitas' || category?.group === 'Income' ? 'income' : 'bill'
}

const frequencyToDays = (frequency: RecurrenceFrequency, interval: number) => {
  const safeInterval = Math.max(1, interval)

  switch (frequency) {
    case 'weekly':
      return { days: safeInterval * 7 }
    case 'fortnightly':
      return { days: safeInterval * 14 }
    case 'monthly':
      return { months: safeInterval }
    case 'bimonthly':
      return { months: safeInterval * 2 }
    case 'quarterly':
      return { months: safeInterval * 3 }
    case 'semiannual':
      return { months: safeInterval * 6 }
    case 'yearly':
      return { months: safeInterval * 12 }
    case 'custom':
      return { days: safeInterval }
    default:
      return { months: safeInterval }
  }
}

const stepDate = (date: Date, frequency: RecurrenceFrequency, interval: number) => {
  const step = frequencyToDays(frequency, interval)
  if ('days' in step) {
    const days = step.days ?? 1
    return addDays(date, days)
  }

  const months = step.months ?? 1
  return addMonths(date, months)
}

const expandRecurringDates = (rule: RecurringRule, start: Date, end: Date) => {
  const dates: Date[] = []
  let current = fromIsoDate(rule.nextDueDate)
  const limit = 365 * 5
  let iterations = 0

  while (isBefore(current, start) && iterations < limit) {
    current = stepDate(current, rule.frequency, rule.interval)
    iterations += 1
  }

  while (!isAfter(current, end) && iterations < limit) {
    dates.push(current)
    current = stepDate(current, rule.frequency, rule.interval)
    iterations += 1
  }

  return dates
}

const formatRangeLabel = (start: Date, end: Date, locale: string) => {
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()}–${end.getDate()} ${shortMonthFormatter(locale).format(end).replace('.', '')}`
  }

  return `${start.getDate()} ${shortMonthFormatter(locale).format(start).replace('.', '')} – ${end.getDate()} ${shortMonthFormatter(locale).format(end).replace('.', '')}`
}

export const formatSimpleCurrency = (amountCents: number, locale: string, currency: string, hidden = false) => {
  if (hidden) {
    return '••••'
  }

  return currencyFormatter(locale, currency).format(amountCents / 100)
}

export const simpleStatusLabel = (status: SimpleStatus) => {
  if (status === 'completed') {
    return 'Completed'
  }

  if (status === 'overdue') {
    return 'Overdue'
  }

  return 'Planned'
}

export const simpleKindLabel = (kind: SimpleKind) => (kind === 'income' ? 'Income' : 'Bill')

export const formatSimpleWeekday = (dateIso: string, locale: string) =>
  weekdayFormatter(locale).format(fromIsoDate(dateIso)).replace('.', '')

export const formatSimpleDay = (dateIso: string, locale: string) => {
  const date = fromIsoDate(dateIso)
  return `${date.getDate()} ${shortMonthFormatter(locale).format(date).replace('.', '')}`
}

export const formatSimpleMonth = (date: Date, locale: string) => monthFormatter(locale).format(date)

export const weekWindow = (referenceDate: Date, weekStartDay: number, locale: string): WeekWindow => {
  const start = startOfWeek(referenceDate, { weekStartsOn: weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 })
  const end = endOfWeek(referenceDate, { weekStartsOn: weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 })
  return {
    start: toIsoDate(start),
    end: toIsoDate(end),
    label: formatRangeLabel(start, end, locale),
  }
}

const transactionKey = (transaction: Transaction) => `${transaction.recurrenceRuleId ?? transaction.id}:${transaction.transactionDate}`

const effectiveTransactionDate = (transaction: Transaction) =>
  transaction.recurrenceRuleId ? transaction.dueDate ?? transaction.transactionDate : transaction.transactionDate

const itemDate = (item: SimpleItem) => item.date

const transactionToItem = (state: AppState, transaction: Transaction, referenceDate: Date): SimpleItem | null => {
  const kind = itemKindFromTransaction(transaction)
  if (!kind || !activeTransaction(transaction)) {
    return null
  }

  return {
    id: transaction.id,
    sourceId: transaction.id,
    sourceKind: 'transaction',
    kind,
    title: transaction.title,
    amountCents: transaction.amountCents,
    date: effectiveTransactionDate(transaction),
    dayLabel: formatSimpleWeekday(effectiveTransactionDate(transaction), state.settings.locale),
    status: transactionResolvedStatus(transaction, referenceDate),
    categoryId: transaction.categoryId,
    personId: transaction.personId,
    notes: transaction.notes,
    transactionId: transaction.id,
    recurrenceRuleId: transaction.recurrenceRuleId,
    editable: true,
  }
}

const recurringToItem = (
  state: AppState,
  rule: RecurringRule,
  date: Date,
  referenceDate: Date,
  linkedTransaction?: Transaction,
): SimpleItem => {
  const dateIso = toIsoDate(date)
  const category = getCategory(state, rule.categoryId)
  const transaction = linkedTransaction
  const transactionCategory = transaction ? getCategory(state, transaction.categoryId) : null
  const kind = transaction
    ? transaction.type === 'income' ? 'income' : 'bill'
    : category?.group === 'Receitas' || category?.group === 'Income' ? 'income' : 'bill'
  const effectiveDate = transaction ? effectiveTransactionDate(transaction) : dateIso
  const status = transaction
    ? transactionResolvedStatus(transaction, referenceDate)
    : isBefore(date, referenceDate) && !isSameDay(date, referenceDate)
      ? 'overdue'
      : 'planned'

  return {
    id: transaction?.id ?? `${rule.id}:${dateIso}`,
    sourceId: rule.id,
    sourceKind: 'recurring',
    kind,
    title: transaction?.title ?? rule.name,
    amountCents: transaction?.amountCents ?? rule.amountCents,
    date: effectiveDate,
    dayLabel: formatSimpleWeekday(effectiveDate, state.settings.locale),
    status,
    categoryId: transactionCategory?.id ?? rule.categoryId,
    personId: transaction?.personId ?? rule.personId,
    notes: transaction?.notes ?? rule.notes,
    transactionId: transaction?.id,
    recurrenceRuleId: rule.id,
    editable: true,
  }
}

export const buildVisibleItems = (state: AppState, startIso: string, endIso: string, referenceDate = new Date()) => {
  const start = fromIsoDate(startIso)
  const end = fromIsoDate(endIso)
  const transactionItems = state.transactions
    .filter((transaction) => activeTransaction(transaction))
    .filter((transaction) => transaction.type === 'income' || transaction.type === 'expense')
    .filter((transaction) => effectiveTransactionDate(transaction) >= startIso && effectiveTransactionDate(transaction) <= endIso)
    .map((transaction) => transactionToItem(state, transaction, referenceDate))
    .filter(Boolean) as SimpleItem[]

  const transactionLookup = new Map<string, Transaction>()
  for (const transaction of state.transactions) {
    if (transaction.recurrenceRuleId) {
      transactionLookup.set(transactionKey(transaction), transaction)
    }
  }

  const recurringItems = state.recurringRules
    .filter((rule) => rule.active)
    .flatMap((rule) =>
      expandRecurringDates(rule, start, end).map((date) => {
        const key = `${rule.id}:${toIsoDate(date)}`
        const linkedTransaction = transactionLookup.get(key)
        if (linkedTransaction?.status === 'cancelled') {
          return null
        }
        return recurringToItem(state, rule, date, referenceDate, linkedTransaction)
      }),
    )
    .filter((item): item is SimpleItem => Boolean(item))
    .filter((item) => item.date >= startIso && item.date <= endIso)
    .filter((item) => !item.transactionId || item.sourceKind === 'recurring')

  const items = [...transactionItems, ...recurringItems].sort((left, right) => {
    const dateDiff = itemDate(left).localeCompare(itemDate(right))
    if (dateDiff !== 0) {
      return dateDiff
    }

    return left.kind === right.kind ? left.title.localeCompare(right.title) : left.kind === 'income' ? -1 : 1
  })

  const deduped = new Map<string, SimpleItem>()
  for (const item of items) {
    const key = item.transactionId ?? `${item.sourceId}:${item.date}`
    const existing = deduped.get(key)

    if (!existing || existing.sourceKind === 'recurring') {
      deduped.set(key, item)
    }
  }

  return [...deduped.values()].sort((left, right) => {
    const dateDiff = left.date.localeCompare(right.date)
    if (dateDiff !== 0) {
      return dateDiff
    }

    return left.kind === right.kind ? left.title.localeCompare(right.title) : left.kind === 'income' ? -1 : 1
  })
}

const summarizeItems = (state: AppState, items: SimpleItem[]) => {
  const incomeItems = items.filter((item) => item.kind === 'income')
  const billItems = items.filter((item) => item.kind === 'bill')
  const incomeCents = sum(incomeItems.map((item) => item.amountCents))
  const expenseCents = sum(billItems.map((item) => item.amountCents))
  const completedIncomeCents = sum(incomeItems.filter((item) => item.status === 'completed').map((item) => item.amountCents))
  const completedExpenseCents = sum(billItems.filter((item) => item.status === 'completed').map((item) => item.amountCents))
  const availableCents = sum(state.accounts.map((account) => account.currentBalanceCents))
  const topCategories = new Map<string, number>()

  for (const item of billItems) {
    topCategories.set(item.categoryId, (topCategories.get(item.categoryId) ?? 0) + item.amountCents)
  }

  return {
    incomeItems,
    billItems,
    incomeCents,
    expenseCents,
    completedIncomeCents,
    completedExpenseCents,
    remainingCents: incomeCents - expenseCents,
    availableCents,
    topCategories: [...topCategories.entries()]
      .map(([categoryId, amountCents]) => ({
        categoryId,
        categoryName: getCategory(state, categoryId)?.name ?? 'Uncategorised',
        amountCents,
      }))
      .sort((left, right) => right.amountCents - left.amountCents),
  }
}

export const buildWeekSnapshot = (state: AppState, referenceDate = new Date()): WeekSnapshot => {
  const window = weekWindow(referenceDate, state.settings.weekStartDay, state.settings.locale)
  const items = buildVisibleItems(state, window.start, window.end, referenceDate)
  const summary = summarizeItems(state, items)

  return {
    ...window,
    ...summary,
    message:
      summary.remainingCents >= 0
        ? `After every bill is paid, you should have ${formatSimpleCurrency(summary.remainingCents, state.settings.locale, state.settings.currency)} left this week.`
        : `You may be short by ${formatSimpleCurrency(Math.abs(summary.remainingCents), state.settings.locale, state.settings.currency)} this week.`,
    topCategories: summary.topCategories,
    items,
  }
}

export const buildNextWeeks = (state: AppState, referenceDate = new Date(), count = 4): WeekPreview[] => {
  const previews: WeekPreview[] = []

  for (let offset = 1; offset <= count; offset += 1) {
    const date = addDays(referenceDate, offset * 7)
    const window = weekWindow(date, state.settings.weekStartDay, state.settings.locale)
    const summary = summarizeItems(state, buildVisibleItems(state, window.start, window.end, date))
    previews.push({
      ...window,
      incomeCents: summary.incomeCents,
      expenseCents: summary.expenseCents,
      remainingCents: summary.remainingCents,
    })
  }

  return previews
}

export const buildMonthCalendar = (state: AppState, monthDate = new Date(), referenceDate = new Date()) => {
  const start = startOfWeek(startOfMonth(monthDate), { weekStartsOn: state.settings.weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 })
  const end = endOfWeek(endOfMonth(monthDate), { weekStartsOn: state.settings.weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 })
  const items = buildVisibleItems(state, toIsoDate(start), toIsoDate(end), referenceDate)
  const days: CalendarDay[] = []

  for (let current = start; !isAfter(current, end); current = addDays(current, 1)) {
    const iso = toIsoDate(current)
    const dayItems = items.filter((item) => item.date === iso)
    const incomeCents = sum(dayItems.filter((item) => item.kind === 'income').map((item) => item.amountCents))
    const expenseCents = sum(dayItems.filter((item) => item.kind === 'bill').map((item) => item.amountCents))

    days.push({
      date: iso,
      dayLabel: current.toLocaleDateString(state.settings.locale, { weekday: 'short' }).replace('.', ''),
      inMonth: current.getMonth() === monthDate.getMonth(),
      incomeCents,
      expenseCents,
      pendingCount: dayItems.filter((item) => item.status !== 'completed').length,
      completedCount: dayItems.filter((item) => item.status === 'completed').length,
      items: dayItems,
    })
  }

  return {
    monthLabel: formatSimpleMonth(monthDate, state.settings.locale),
    days,
    list: days.filter((day) => day.items.length > 0),
  }
}

export const summarizeRange = (state: AppState, startIso: string, endIso: string, referenceDate = new Date()): RangeSummary => {
  const items = buildVisibleItems(state, startIso, endIso, referenceDate)
  const summary = summarizeItems(state, items)
  const start = fromIsoDate(startIso)
  const end = fromIsoDate(endIso)

  return {
    start: startIso,
    end: endIso,
    label: formatRangeLabel(start, end, state.settings.locale),
    incomeCents: summary.incomeCents,
    expenseCents: summary.expenseCents,
    remainingCents: summary.remainingCents,
    availableCents: summary.availableCents,
    completedIncomeCents: summary.completedIncomeCents,
    completedExpenseCents: summary.completedExpenseCents,
    items,
    topCategories: summary.topCategories,
    message:
      summary.remainingCents >= 0
        ? `After the bills are paid, you should have ${formatSimpleCurrency(summary.remainingCents, state.settings.locale, state.settings.currency)} left.`
        : `You may be short by ${formatSimpleCurrency(Math.abs(summary.remainingCents), state.settings.locale, state.settings.currency)}.`,
  }
}

export const buildMonthlyTrend = (state: AppState, months = 12, referenceDate = new Date()): TrendPoint[] => {
  const trend: TrendPoint[] = []

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const monthDate = startOfMonth(addMonths(referenceDate, -offset))
    const startIso = toIsoDate(monthDate)
    const endIso = toIsoDate(endOfMonth(monthDate))
    const summary = summarizeRange(state, startIso, endIso, referenceDate)

    trend.push({
      month: monthKey(startIso),
      label: new Intl.DateTimeFormat(state.settings.locale, {
        month: 'short',
      }).format(monthDate).replace('.', ''),
      incomeCents: summary.incomeCents,
      expenseCents: summary.expenseCents,
      remainingCents: summary.remainingCents,
    })
  }

  return trend
}

export const buildCategoryDistribution = (state: AppState, startIso: string, endIso: string, referenceDate = new Date()) => {
  const summary = summarizeRange(state, startIso, endIso, referenceDate)
  return summary.topCategories.slice(0, 6)
}

export const getWeekRangeLabel = (state: AppState, referenceDate = new Date()) =>
  weekWindow(referenceDate, state.settings.weekStartDay, state.settings.locale).label

export const findItemById = (items: SimpleItem[], itemId: string) => items.find((item) => item.id === itemId) ?? null

export const kindFromTransaction = itemKindFromTransaction

export const categoryKind = kindFromCategory
