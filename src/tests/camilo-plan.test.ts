import { describe, expect, it } from 'vitest'
import { applyCamiloPlanUpdate, applyRequestedCamiloUpdates } from '@/domain/camilo-plan'
import { createDemoState } from '@/domain/seed'
import { buildVisibleItems } from '@/domain/home'
import { buildPlanningWeeks } from '@/domain/planning'
import { validateEntityPayload } from '@/sync/entities'
import type { RecurringRule } from '@/domain/model'

function legacyPlan() {
  const state = createDemoState()
  state.household.weekStartDay = state.settings.weekStartDay = 4
  state.recurringRules[0] = { ...state.recurringRules[0], name: 'Camilo Wages', amountCents: 53000 }
  return state
}

describe('requested Camilo plan', () => {
  it('activates the existing monthly salary and stops the weekly rule when the monthly record was inactive', () => {
    const state = legacyPlan()
    const weekly = state.recurringRules[0]
    state.recurringRules.push({ ...weekly, id: 'existing-monthly', name: 'Camilo Wage', frequency: 'monthly', amountCents: 288300,
      nextDueDate: '2026-11-25', active: false, adjustToPrevFriday: true })
    const updated = applyCamiloPlanUpdate(state)
    expect(updated.recurringRules.find((rule) => rule.id === weekly.id)?.active).toBe(false)
    expect(updated.recurringRules.find((rule) => rule.id === 'existing-monthly')).toMatchObject({ active: true, frequency: 'monthly', amountCents: 288300, adjustToPrevFriday: true })
    const items = buildVisibleItems(updated, '2026-11-01', '2026-12-31', new Date(2026, 10, 3)).filter((item) => item.title === 'Camilo Wage')
    expect(items.map((item) => item.date)).toEqual(['2026-11-25', '2026-12-25'])
    expect(items.every((item) => item.recurrenceRuleId === 'existing-monthly')).toBe(true)
    expect(updated.transactions).toBe(state.transactions)
    expect(applyCamiloPlanUpdate(updated)).toBe(updated)
  })
  it('keeps Remarkable Iris on the 17th and disables the confirmed duplicate on the 18th without deleting history', () => {
    const state = legacyPlan()
    const base = { ...state.recurringRules[0], name: 'Remarkable Iris', amountCents: 399, frequency: 'monthly' as const }
    state.recurringRules.push({ ...base, id: 'keep', nextDueDate: '2026-08-17' }, { ...base, id: 'duplicate', nextDueDate: '2026-08-18' })
    const updated = applyRequestedCamiloUpdates(state)
    expect(updated.recurringRules.find((rule) => rule.id === 'keep')?.active).toBe(true)
    expect(updated.recurringRules.find((rule) => rule.id === 'duplicate')?.active).toBe(false)
    expect(updated.transactions).toBe(state.transactions)
    expect(applyRequestedCamiloUpdates(updated)).toBe(updated)
  })
  it('converts the weekly salary and week start without changing history, balances or other income', () => {
    const original = legacyPlan()
    const next = applyCamiloPlanUpdate(original)
    expect(next.household.weekStartDay).toBe(1)
    expect(next.settings.weekStartDay).toBe(1)
    expect(next.recurringRules[0]).toMatchObject({
      id: original.recurringRules[0].id, name: 'Camilo Wage', frequency: 'monthly',
      amountCents: 288300, interval: 1, nextDueDate: '2026-11-25', adjustToPrevFriday: true,
    })
    expect(next.transactions).toBe(original.transactions)
    expect(next.accounts).toBe(original.accounts)
    expect(next.recurringRules.slice(1)).toEqual(original.recurringRules.slice(1))
    expect(original.recurringRules[0].frequency).toBe('weekly')
    expect(applyCamiloPlanUpdate(next)).toBe(next)
    const weeks = buildPlanningWeeks(next, '2026-11-01', '2026-11-30', new Date(2026, 10, 3), 0)
    expect(new Date(`${weeks[0].start}T12:00:00`).getDay()).toBe(1)
    expect(new Date(`${weeks[0].end}T12:00:00`).getDay()).toBe(0)
  })

  it('produces one monthly payment and keeps Monday while advancing weekend payments to Friday', () => {
    const state = applyCamiloPlanUpdate(legacyPlan())
    const salary = state.recurringRules[0]
    const dates = buildVisibleItems(state, '2026-11-01', '2027-12-31', new Date(2026, 10, 1))
      .filter((item) => item.recurrenceRuleId === salary.id)
      .map((item) => item.date)
    expect(dates).toHaveLength(14)
    expect(dates).toContain('2026-11-25')
    expect(dates).toContain('2027-01-25') // Monday stays Monday.
    expect(dates).toContain('2027-04-23') // Sunday 25th -> Friday 23rd.
    expect(dates).toContain('2027-09-24') // Saturday 25th -> Friday 24th.
    const fridayOnly = buildVisibleItems(state, '2027-09-24', '2027-09-24', new Date(2027, 8, 24))
      .filter((item) => item.recurrenceRuleId === salary.id)
    expect(fridayOnly).toHaveLength(1)
    expect(fridayOnly[0].amountCents).toBe(288300)
  })

  it('preserves the weekend adjustment through sync validation', () => {
    const salary = applyCamiloPlanUpdate(legacyPlan()).recurringRules[0]
    expect(validateEntityPayload<RecurringRule>('recurring_rules', salary).adjustToPrevFriday).toBe(true)
  })

  it('disables duplicate Camilo income rules and leaves unrelated households untouched', () => {
    const state = legacyPlan()
    state.recurringRules.push({ ...state.recurringRules[0], id: 'duplicate' })
    const next = applyCamiloPlanUpdate(state)
    expect(next.recurringRules.filter((rule) => rule.active && rule.name.startsWith('Camilo'))).toHaveLength(1)
    const other = createDemoState()
    expect(applyCamiloPlanUpdate(other)).toBe(other)
  })
})
