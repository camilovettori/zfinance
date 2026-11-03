import { describe, expect, it } from 'vitest'
import { createDemoState } from '@/domain/seed'
import { buildCalendarForecast } from '@/domain/calendar-forecast'
import { ensureCalculatedState } from '@/domain/calculations'

describe('calendar forecast endpoints', () => {
  it('uses exact calendar month/year ends and excludes adjacent days and already-paid items', () => {
    const state = createDemoState()
    state.goals = []
    state.recurringRules = []
    state.accounts = [{ ...state.accounts[0], type: 'current', openingBalanceCents: 812194, currentBalanceCents: 812194 }]
    const base = { ...state.transactions[0], accountId: state.accounts[0].id, status: 'planned' as const }
    state.transactions = [
      { ...base, id: 'nov-income', type: 'income', transactionDate: '2026-11-25', dueDate: '2026-11-25', amountCents: 288300 },
      { ...base, id: 'nov-bill', type: 'expense', transactionDate: '2026-11-15', dueDate: '2026-11-15', amountCents: 17700 },
      { ...base, id: 'dec-income', type: 'income', transactionDate: '2026-12-25', dueDate: '2026-12-25', amountCents: 288300 },
      { ...base, id: 'dec-bill', type: 'expense', transactionDate: '2026-12-01', dueDate: '2026-12-01', amountCents: 10000 },
      { ...base, id: 'next-year', type: 'expense', transactionDate: '2027-01-01', dueDate: '2027-01-01', amountCents: 99999 },
    ]
    const now = new Date(2026, 10, 3)
    const forecast = buildCalendarForecast(state, now, now)
    expect(forecast.availableNowCents).toBe(812194)
    expect(forecast.monthEnd).toEqual({ date: '2026-11-30', balanceCents: 1082794 })
    expect(forecast.yearEnd).toEqual({ date: '2026-12-31', balanceCents: 1361094 })
    const december = buildCalendarForecast(state, new Date(2026, 11, 15), now)
    expect(december.monthEnd).toEqual(december.yearEnd)
  })

  it('deducts only the remaining savings goal after a completed contribution', () => {
    const state = createDemoState()
    state.recurringRules = []
    state.goals = [{ ...state.goals[0], monthlyContributionCents: 10000, archived: false }]
    const bank = { ...state.accounts[0], type: 'current' as const, openingBalanceCents: 100000, currentBalanceCents: 100000 }
    const savings = { ...state.accounts[1], id: 'savings', type: 'savings' as const, openingBalanceCents: 0, currentBalanceCents: 0 }
    state.accounts = [bank, savings]
    state.transactions = [{ ...state.transactions[0], id: 'funded', type: 'transfer', status: 'paid', accountId: bank.id,
      counterpartyAccountId: savings.id, amountCents: 4000, transactionDate: '2026-11-02', dueDate: '2026-11-02' }]
    const calculated = ensureCalculatedState(state)
    const forecast = buildCalendarForecast(calculated, new Date(2026, 10, 3), new Date(2026, 10, 3))
    expect(forecast.availableNowCents).toBe(96000)
    expect(forecast.monthEnd.balanceCents).toBe(90000)
    expect(forecast.yearEnd.balanceCents).toBe(80000)
  })
})
