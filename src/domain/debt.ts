import type { AccountType, AppState } from './model'

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

export function buildDebtSummary(state: AppState): DebtSummary {
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

  return {
    accounts,
    totalOwedCents,
    originalTotalCents,
    paidOffCents,
    paidOffPercent,
    monthlyPaymentPaceCents: 0,
    monthsRemaining: null,
    payoffDateIso: null,
    isDebtFree: totalOwedCents === 0,
  }
}
