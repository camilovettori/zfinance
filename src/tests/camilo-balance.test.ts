import { describe, expect, it } from 'vitest'
import { applyCamiloBalanceUpdate } from '@/domain/camilo-balance'
import { ensureCalculatedState } from '@/domain/calculations'
import { currentSpendableBalance } from '@/domain/cashflow'
import { createDemoState } from '@/domain/seed'
import { validateEntityPayload } from '@/sync/entities'
import type { FinancialAccount } from '@/domain/model'

function household() {
  const state = createDemoState()
  state.household.currency = state.settings.currency = 'EUR'
  state.accounts = state.accounts.map((account) => ({ ...account, currency: 'EUR' }))
  state.recurringRules[0].name = 'Camilo Wage'
  return state
}

describe('requested balance correction', () => {
  it.each([0, 1000000, -20000])('sets the available total to €8,121.94 from opening %i while preserving transactions', (opening) => {
    const original = household()
    original.accounts[0].openingBalanceCents = opening
    original.accounts[0].currentBalanceCents = 99999999 // Ignore stale cached balance.
    const next = applyCamiloBalanceUpdate(original)
    expect(currentSpendableBalance(next)).toBe(812194)
    expect(next.transactions).toBe(original.transactions)
    expect(next.accounts.slice(1)).toEqual(ensureCalculatedState(original).accounts.slice(1))
    expect(applyCamiloBalanceUpdate(next)).toBe(next)
    const account = next.accounts.find((entry) => entry.balanceCorrectionId)!
    expect(validateEntityPayload<FinancialAccount>('financial_accounts', account).balanceCorrectionId).toBe(account.balanceCorrectionId)
  })

  it('does not reset the balance after later spending or a saved-state reload', () => {
    const updated = applyCamiloBalanceUpdate(household())
    const account = updated.accounts.find((entry) => entry.balanceCorrectionId)!
    updated.transactions.push({ ...updated.transactions[0], id: 'later-expense', accountId: account.id,
      type: 'expense', status: 'paid', amountCents: 1000, counterpartyAccountId: undefined })
    const reloaded = ensureCalculatedState(JSON.parse(JSON.stringify(updated)))
    expect(currentSpendableBalance(applyCamiloBalanceUpdate(reloaded))).toBe(811194)
  })

  it('leaves unrelated households unchanged', () => {
    const original = createDemoState()
    expect(applyCamiloBalanceUpdate(original)).toBe(original)
  })
})
