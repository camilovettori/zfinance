import type { AppState } from './model'
import { ensureCalculatedState } from './calculations'
import { currentSpendableBalance } from './cashflow'

const correctionId = 'camilo-balance-2026-11-03-812194'
const targetCents = 812194

// Explicit balance reconciliation requested on 3 November 2026. The marker is
// stored and synced with the account so later spending never resets the balance.
export function applyCamiloBalanceUpdate(state: AppState): AppState {
  if (state.household.currency !== 'EUR'
    || state.accounts.some((account) => account.balanceCorrectionId === correctionId)
    || !state.recurringRules.some((rule) => rule.active && /^camilo (wages?|salary)$/i.test(rule.name.trim()))) return state

  const candidates = state.accounts.filter((account) => !account.archived && account.currency === 'EUR'
    && ['current', 'joint', 'cash', 'manual'].includes(account.type))
  const everyday = candidates.filter((account) => /everyday/i.test(account.name))
  const account = everyday.length === 1 ? everyday[0] : candidates.length === 1 ? candidates[0] : undefined
  if (!account) return state

  const calculated = ensureCalculatedState(state)
  const delta = targetCents - currentSpendableBalance(calculated)
  return ensureCalculatedState({
    ...state,
    accounts: state.accounts.map((candidate) => candidate.id === account.id ? {
      ...candidate,
      openingBalanceCents: candidate.openingBalanceCents + delta,
      balanceCorrectionId: correctionId,
    } : candidate),
  })
}
