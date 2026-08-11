import { addMonths, startOfMonth, subMonths } from 'date-fns'
import type { AccountType, AppState, RecurringRule } from './model'
import { toIsoDate } from '@/lib/date'

export const LIABILITY_ACCOUNT_TYPES = ['credit-card', 'loan', 'financing'] as const

export type LiabilityAccountSummary = {
  accountId: string
  name: string
  type: AccountType
  owedCents: number
  accentColor: string
}

export type DebtSummary = {
  accounts: LiabilityAccountSummary[]
  totalOwedCents: number
  originalTotalCents: number
  paidOffCents: number
  paidOffPercent: number
  monthlyPaymentPaceCents: number
  monthsRemaining: number | null
  payoffDateIso: string | null
  isDebtFree: boolean
}

function liabilityAccounts(state: AppState) {
  return state.accounts.filter(
    (account) => !account.archived && LIABILITY_ACCOUNT_TYPES.includes(account.type as (typeof LIABILITY_ACCOUNT_TYPES)[number]),
  )
}

const isLiabilityAccount = (state: AppState, accountId: string) => {
  const account = state.accounts.find((candidate) => candidate.id === accountId)
  return Boolean(account && !account.archived && LIABILITY_ACCOUNT_TYPES.includes(account.type as (typeof LIABILITY_ACCOUNT_TYPES)[number]))
}

const MONTHLY_FACTOR: Partial<Record<RecurringRule['frequency'], number>> = {
  weekly: 52 / 12,
  fortnightly: 26 / 12,
  monthly: 1,
  yearly: 1 / 12,
}

function paymentHistoryPaceCents(state: AppState, referenceDate: Date) {
  const windowEnd = startOfMonth(referenceDate)
  const windowStart = subMonths(windowEnd, 3)
  const windowEndIso = toIsoDate(windowEnd)
  const windowStartIso = toIsoDate(windowStart)
  const total = state.transactions
    .filter((transaction) => transaction.status === 'paid')
    .filter((transaction) => transaction.transactionDate >= windowStartIso && transaction.transactionDate < windowEndIso)
    .filter((transaction) =>
      (transaction.type === 'expense' && isLiabilityAccount(state, transaction.accountId)) ||
      (transaction.type === 'transfer' && isLiabilityAccount(state, transaction.counterpartyAccountId ?? '')),
    )
    .reduce((sum, transaction) => sum + transaction.amountCents, 0)
  return Math.round(total / 3)
}

function recurringRulePaceCents(state: AppState) {
  return state.recurringRules
    .filter((rule) => rule.active && isLiabilityAccount(state, rule.accountId))
    .reduce((sum, rule) => sum + rule.amountCents * (MONTHLY_FACTOR[rule.frequency] ?? 0), 0)
}

export function buildDebtSummary(state: AppState, referenceDate = new Date()): DebtSummary {
  const accounts = liabilityAccounts(state).map((account) => ({
    accountId: account.id,
    name: account.name,
    type: account.type,
    owedCents: Math.abs(account.currentBalanceCents),
    accentColor: account.accentColor,
  }))

  const totalOwedCents = accounts.reduce((total, account) => total + account.owedCents, 0)
  const originalTotalCents = liabilityAccounts(state).reduce((total, account) => total + Math.abs(account.openingBalanceCents), 0)
  const paidOffCents = Math.max(0, originalTotalCents - totalOwedCents)
  const paidOffPercent = originalTotalCents === 0 ? 100 : Math.round((paidOffCents / originalTotalCents) * 100)

  const historyPace = paymentHistoryPaceCents(state, referenceDate)
  const monthlyPaymentPaceCents = historyPace > 0 ? historyPace : Math.round(recurringRulePaceCents(state))
  const monthsRemaining = monthlyPaymentPaceCents > 0 && totalOwedCents > 0
    ? Math.ceil(totalOwedCents / monthlyPaymentPaceCents)
    : null
  const payoffDateIso = monthsRemaining === null ? null : toIsoDate(addMonths(referenceDate, monthsRemaining))

  return {
    accounts,
    totalOwedCents,
    originalTotalCents,
    paidOffCents,
    paidOffPercent,
    monthlyPaymentPaceCents,
    monthsRemaining,
    payoffDateIso,
    isDebtFree: totalOwedCents === 0,
  }
}
