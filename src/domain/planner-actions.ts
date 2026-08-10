import type { SimpleItem } from './home'
import type { AppState, RecurringRule, Transaction } from './model'

export const isCompletedPlannerItem = (item: SimpleItem) => item.status === 'completed'

export function moveOneOffPlannerItem(
  state: AppState,
  item: SimpleItem,
  targetDate: string,
  updatedAt: string,
): AppState {
  if (!item.transactionId || item.recurrenceRuleId || isCompletedPlannerItem(item)) return state
  return {
    ...state,
    transactions: state.transactions.map((transaction) => transaction.id === item.transactionId
      ? { ...transaction, transactionDate: targetDate, dueDate: targetDate, updatedAt }
      : transaction),
  }
}

type OccurrenceOverrideOptions = {
  targetDate: string
  amountCents?: number
  id: string
  now: string
}

export function upsertPlannerOccurrenceOverride(
  state: AppState,
  item: SimpleItem,
  rule: RecurringRule,
  options: OccurrenceOverrideOptions,
): AppState {
  const existing = item.transactionId
    ? state.transactions.find((transaction) => transaction.id === item.transactionId)
    : state.transactions.find((transaction) =>
        transaction.recurrenceRuleId === rule.id && transaction.transactionDate === item.date,
      )
  const transaction: Transaction = {
    id: existing?.id ?? options.id,
    householdId: state.household.id,
    title: existing?.title ?? item.title,
    description: existing?.description ?? item.title,
    amountCents: options.amountCents ?? existing?.amountCents ?? item.amountCents,
    type: item.kind === 'income' ? 'income' : 'expense',
    categoryId: existing?.categoryId ?? rule.categoryId,
    accountId: existing?.accountId ?? rule.accountId,
    transactionDate: existing?.transactionDate ?? item.date,
    dueDate: options.targetDate,
    paidDate: existing?.paidDate,
    status: existing?.status ?? 'planned',
    personId: existing?.personId ?? rule.personId,
    payee: existing?.payee ?? rule.personId,
    paymentMethod: existing?.paymentMethod ?? 'Local',
    recurrenceRuleId: rule.id,
    tags: existing?.tags ?? [],
    notes: existing?.notes ?? rule.notes ?? item.notes ?? '',
    source: existing?.source ?? 'manual',
    splits: existing?.splits ?? [],
    createdAt: existing?.createdAt ?? options.now,
    updatedAt: options.now,
  }
  return {
    ...state,
    transactions: existing
      ? state.transactions.map((entry) => entry.id === existing.id ? transaction : entry)
      : [transaction, ...state.transactions],
  }
}

type SeriesPatch = {
  nextDueDate?: string
  amountCents?: number
  updatedAt: string
}

export function updatePlannerSeriesFromOccurrence(
  state: AppState,
  item: SimpleItem,
  rule: RecurringRule,
  patch: SeriesPatch,
): AppState {
  return {
    ...state,
    recurringRules: state.recurringRules.map((entry) => entry.id === rule.id
      ? { ...entry, nextDueDate: patch.nextDueDate ?? entry.nextDueDate, amountCents: patch.amountCents ?? entry.amountCents }
      : entry),
    transactions: state.transactions.filter((transaction) => {
      const isFutureOverride = transaction.recurrenceRuleId === rule.id &&
        transaction.transactionDate >= item.date &&
        ['planned', 'pending', 'overdue'].includes(transaction.status)
      return !isFutureOverride
    }),
    auditEvents: [{
      id: crypto.randomUUID(),
      createdAt: patch.updatedAt,
      entityType: 'recurring_rule',
      entityId: rule.id,
      action: 'planner_series_updated',
      detailsJson: JSON.stringify({ fromOccurrence: item.date, ...patch }),
    }, ...state.auditEvents],
  }
}

export function updateOneOffPlannerAmount(
  state: AppState,
  item: SimpleItem,
  amountCents: number,
  updatedAt: string,
): AppState {
  if (!item.transactionId || item.recurrenceRuleId || amountCents <= 0) return state
  return {
    ...state,
    transactions: state.transactions.map((transaction) => transaction.id === item.transactionId
      ? { ...transaction, amountCents, updatedAt }
      : transaction),
  }
}

export function completePlannerItem(
  state: AppState,
  item: SimpleItem,
  id: string,
  now: string,
): AppState {
  const completedStatus = item.kind === 'income' ? 'received' : 'paid'
  if (item.transactionId) {
    return {
      ...state,
      transactions: state.transactions.map((transaction) => transaction.id === item.transactionId
        ? { ...transaction, status: completedStatus, paidDate: item.date, updatedAt: now }
        : transaction),
    }
  }
  const rule = item.recurrenceRuleId
    ? state.recurringRules.find((entry) => entry.id === item.recurrenceRuleId)
    : undefined
  const accountId = rule?.accountId ?? state.accounts[0]?.id
  if (!accountId) return state
  const transaction: Transaction = {
    id,
    householdId: state.household.id,
    title: item.title,
    description: item.title,
    amountCents: item.amountCents,
    type: item.kind === 'income' ? 'income' : 'expense',
    categoryId: item.categoryId,
    accountId,
    transactionDate: item.date,
    dueDate: item.date,
    paidDate: item.date,
    status: completedStatus,
    personId: item.personId ?? rule?.personId,
    recurrenceRuleId: item.recurrenceRuleId,
    tags: [],
    notes: item.notes ?? rule?.notes ?? '',
    source: 'manual',
    splits: [],
    createdAt: now,
    updatedAt: now,
  }
  return { ...state, transactions: [transaction, ...state.transactions] }
}
