import { addDays } from 'date-fns'
import { buildVisibleItems } from './home'
import type { AppState, Transaction } from './model'
import { fromIsoDate, todayIso, toIsoDate } from '@/lib/date'

export type RollingBalanceDay = {
  date: string
  projectedFlowCents: number
  closingBalanceCents: number
}

export type RollingBalanceProjection = {
  openingBalanceCents: number
  closingBalanceCents: number
  days: RollingBalanceDay[]
}

const completed = (transaction: Transaction) => transaction.status === 'paid' || transaction.status === 'received'

const itemFlow = (kind: 'income' | 'bill', amountCents: number) => kind === 'income' ? amountCents : -amountCents

const spendableAccountIds = (state: AppState) => {
  const ids = state.accounts
    .filter((account) => !account.archived && ['current', 'joint', 'cash', 'manual'].includes(account.type))
    .map((account) => account.id)
  return new Set(ids.length ? ids : state.accounts.filter((account) => !account.archived).map((account) => account.id))
}

const transactionEffect = (transaction: Transaction, accountIds: Set<string>) => {
  if (!completed(transaction) || transaction.status === 'cancelled') return 0
  if (transaction.type === 'transfer') {
    return (accountIds.has(transaction.counterpartyAccountId ?? '') ? transaction.amountCents : 0) -
      (accountIds.has(transaction.accountId) ? transaction.amountCents : 0)
  }
  if (!accountIds.has(transaction.accountId)) return 0
  if (transaction.type === 'income' || transaction.type === 'adjustment') return transaction.amountCents
  if (transaction.type === 'expense') return -transaction.amountCents
  return 0
}

export const currentSpendableBalance = (state: AppState) => {
  const ids = spendableAccountIds(state)
  return state.accounts.filter((account) => ids.has(account.id)).reduce((total, account) => total + account.currentBalanceCents, 0)
}

export function buildRollingBalanceProjection(
  state: AppState,
  startIso: string,
  endIso: string,
  referenceDate = new Date(),
): RollingBalanceProjection {
  const anchorIso = toIsoDate(referenceDate)
  const accountIds = spendableAccountIds(state)
  const currentBalanceCents = currentSpendableBalance(state)
  const queryStart = startIso < anchorIso ? startIso : anchorIso
  const queryEnd = endIso > anchorIso ? endIso : anchorIso
  const visibleItems = buildVisibleItems(state, queryStart, queryEnd, referenceDate)

  let openingBalanceCents = currentBalanceCents
  if (startIso <= anchorIso) {
    const completedSinceStart = state.transactions
      .filter((transaction) => transaction.transactionDate >= startIso && transaction.transactionDate <= anchorIso)
      .reduce((total, transaction) => total + transactionEffect(transaction, accountIds), 0)
    openingBalanceCents -= completedSinceStart
  } else {
    openingBalanceCents += visibleItems
      .filter((item) => item.date >= anchorIso && item.date < startIso && item.status !== 'completed')
      .reduce((total, item) => total + itemFlow(item.kind, item.amountCents), 0)
  }

  let runningBalance = openingBalanceCents
  const days: RollingBalanceDay[] = []
  for (let date = fromIsoDate(startIso); toIsoDate(date) <= endIso; date = addDays(date, 1)) {
    const dateIso = toIsoDate(date)
    let projectedFlowCents = 0
    if (dateIso <= anchorIso) {
      projectedFlowCents += state.transactions
        .filter((transaction) => transaction.transactionDate === dateIso)
        .reduce((total, transaction) => total + transactionEffect(transaction, accountIds), 0)
    }
    if (dateIso >= anchorIso) {
      projectedFlowCents += visibleItems
        .filter((item) => item.date === dateIso && item.status !== 'completed')
        .reduce((total, item) => total + itemFlow(item.kind, item.amountCents), 0)
    }
    runningBalance += projectedFlowCents
    days.push({ date: dateIso, projectedFlowCents, closingBalanceCents: runningBalance })
  }

  return { openingBalanceCents, closingBalanceCents: runningBalance, days }
}

export function buildCurrentWeekRollingBalance(state: AppState) {
  const start = todayIso()
  return buildRollingBalanceProjection(state, start, toIsoDate(addDays(fromIsoDate(start), 6)))
}
