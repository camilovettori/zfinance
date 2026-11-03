import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createBlankState } from '@/domain/seed'
import { ensureCalculatedState } from '@/domain/calculations'
import { applyRequestedCamiloUpdates } from '@/domain/camilo-plan'
import { cleanupOneOffRecurringDuplicates } from '@/domain/deduplication'
import { buildCalendarForecast } from '@/domain/calendar-forecast'
import { buildVisibleItems } from '@/domain/home'
import { buildPlannerOpeningBalance, buildPlanningWeeks, buildPlannerCycleSummary } from '@/domain/planning'

// Optional private snapshot: never store financial exports in the repository.
describe.skipIf(!process.env.HOMECOIN_AUDIT_SNAPSHOT)('connected household read-only snapshot audit', () => {
  it('recalculates cloud account balances and verifies the corrected local plan independently', () => {
    const snapshot = JSON.parse(readFileSync(process.env.HOMECOIN_AUDIT_SNAPSHOT!, 'utf8'))
    const blank = createBlankState()
    const original = { ...blank, ...snapshot, settings: { ...blank.settings, ...snapshot.settings } }
    const recalculated = ensureCalculatedState(original)
    expect(recalculated.accounts.map((account) => account.currentBalanceCents)).toEqual(original.accounts.map((account: { currentBalanceCents: number }) => account.currentBalanceCents))
    const cleanup = cleanupOneOffRecurringDuplicates(recalculated)
    const state = ensureCalculatedState(applyRequestedCamiloUpdates(cleanup.state))
    const now = new Date(2026, 10, 3, 12)
    const forecast = buildCalendarForecast(state, now, now)
    const events = buildVisibleItems(state, '2026-11-03', '2026-12-31', now).filter((item) => item.status !== 'completed')
    expect(events.filter((item) => item.title === 'Remarkable Iris').map((item) => item.date)).toEqual(['2026-11-17', '2026-12-17'])
    const sumThrough = (end: string) => events.filter((item) => item.date <= end).reduce((sum, item) => sum + (item.kind === 'income' ? item.amountCents : -item.amountCents), 0)
    expect(forecast.availableNowCents).toBe(812194)
    expect(forecast.monthEnd.balanceCents).toBe(812194 + sumThrough('2026-11-30'))
    expect(forecast.yearEnd.balanceCents).toBe(812194 + sumThrough('2026-12-31'))
    const december = buildCalendarForecast(state, new Date(2026, 11, 1), now)
    expect(december.monthEnd).toEqual(december.yearEnd)
    const opening = buildPlannerOpeningBalance(state, '2026-10-26', now)
    const weeks = buildPlanningWeeks(state, '2026-11-01', '2026-11-30', now, 0, opening)
    for (const week of weeks) expect(week.closingBalanceCents).toBe(week.openingBalanceCents + week.incomeCents - week.expenseCents)
    const cycle = buildPlannerCycleSummary(weeks)
    expect(cycle.closingBalanceCents).toBe(cycle.openingBalanceCents + cycle.incomeCents - cycle.expenseCents)
    const duplicates = state.recurringRules.filter((rule, index, all) => rule.active && all.some((other, otherIndex) => otherIndex < index && other.active && other.name === rule.name && other.amountCents === rule.amountCents && other.frequency === rule.frequency))
    const result = { rawCloudBalanceCents: original.accounts[0].currentBalanceCents, correctedForecast: forecast, decemberForecast: december,
      removedOneOffDuplicates: cleanup.removed.length, possibleRepeatedRules: duplicates.map((rule) => ({ name: rule.name, cents: rule.amountCents, due: rule.nextDueDate })),
      transactions: state.transactions.length, rules: state.recurringRules.length }
    writeFileSync(join(tmpdir(), 'zfinance-audit-results-20261103.json'), JSON.stringify(result, null, 2))
    console.info('Snapshot audit summary:', JSON.stringify(result))
  })
})
