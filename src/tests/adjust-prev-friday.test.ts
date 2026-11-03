import { describe, expect, it } from 'vitest'
import { adjustToPreviousFriday } from '@/domain/home'
import { buildVisibleItems } from '@/domain/home'
import { createBlankState } from '@/domain/seed'
import type { RecurringRule } from '@/domain/model'

describe('adjustToPreviousFriday', () => {
  it('returns the same date for Tuesday', () => {
    const date = new Date(2026, 10, 24) // Nov 24 2026 = Tuesday
    const result = adjustToPreviousFriday(date)
    expect(result.getDay()).toBe(2) // still Tuesday
    expect(result.getDate()).toBe(24)
  })

  it('returns the same date for Wednesday', () => {
    const date = new Date(2026, 10, 25) // Nov 25 2026 = Wednesday
    const result = adjustToPreviousFriday(date)
    expect(result.getDay()).toBe(3) // still Wednesday
    expect(result.getDate()).toBe(25)
  })

  it('returns the same date for Thursday', () => {
    const date = new Date(2026, 11, 24) // Dec 24 2026 = Thursday
    const result = adjustToPreviousFriday(date)
    expect(result.getDay()).toBe(4) // still Thursday
    expect(result.getDate()).toBe(24)
  })

  it('returns the same date for Friday', () => {
    const date = new Date(2026, 8, 25) // Sep 25 2026 = Friday
    expect(date.getDay()).toBe(5) // verify it's Friday
    const result = adjustToPreviousFriday(date)
    expect(result.getDay()).toBe(5)
    expect(result.getDate()).toBe(25)
  })

  it('shifts Saturday back to Friday (-1 day)', () => {
    // Sep 26 2027 is a Sunday — let's find a Saturday
    const date = new Date(2027, 8, 25) // Sep 25 2027 = Saturday
    expect(date.getDay()).toBe(6) // verify it's Saturday
    const result = adjustToPreviousFriday(date)
    expect(result.getDay()).toBe(5) // Friday
    expect(result.getDate()).toBe(24) // Sep 24
  })

  it('shifts Sunday back to Friday (-2 days)', () => {
    const date = new Date(2026, 9, 25) // Oct 25 2026 = Sunday
    expect(date.getDay()).toBe(0) // verify it's Sunday
    const result = adjustToPreviousFriday(date)
    expect(result.getDay()).toBe(5) // Friday
    expect(result.getDate()).toBe(23) // Oct 23
  })

  it('keeps Monday on the scheduled payday', () => {
    const date = new Date(2027, 0, 25) // Jan 25 2027 = Monday
    expect(date.getDay()).toBe(1) // verify it's Monday
    const result = adjustToPreviousFriday(date)
    expect(result.getDay()).toBe(1) // Monday
    expect(result.getDate()).toBe(25) // Jan 25
  })
})

describe('expandRecurringDates with adjustToPrevFriday', () => {
  const createTestState = () => {
    const state = createBlankState()
    state.household.currency = 'EUR'
    state.household.locale = 'en-IE'
    state.settings.currency = 'EUR'
    state.settings.locale = 'en-IE'
    return state
  }

  it('monthly salary on 25th stays anchored across 12 months', () => {
    const state = createTestState()

    const salaryRule: RecurringRule = {
      id: 'test-salary',
      householdId: state.household.id,
      name: 'Camilo Salary',
      amountCents: 288_300,
      frequency: 'monthly',
      interval: 1,
      nextDueDate: '2026-09-25',
      accountId: state.accounts[0]?.id ?? 'acc-1',
      categoryId: state.categories.find((c) => c.group === 'Income')?.id ?? 'cat-1',
      generateAutomatically: true,
      reminder: true,
      active: true,
      adjustToPrevFriday: true,
    }

    // Ensure category exists for income
    if (!state.categories.find((c) => c.group === 'Income')) {
      state.categories.push({
        id: 'cat-income',
        householdId: state.household.id,
        name: 'Salary',
        group: 'Income',
        order: 0,
        archived: false,
        color: '#2F7D5B',
        icon: 'money',
      })
      salaryRule.categoryId = 'cat-income'
    }

    if (!state.accounts.length) {
      state.accounts.push({
        id: 'acc-main',
        householdId: state.household.id,
        name: 'Current',
        institution: '',
        type: 'current',
        currency: 'EUR',
        openingBalanceCents: 0,
        currentBalanceCents: 0,
        holder: '',
        accentColor: '',
        archived: false,
        notes: '',
      })
      salaryRule.accountId = 'acc-main'
    }

    state.recurringRules.push(salaryRule)

    // Build items for Sep 2026 to Aug 2027
    const items = buildVisibleItems(state, '2026-09-01', '2027-08-31', new Date('2026-09-01'))
    const salaryItems = items.filter((i) => i.title === 'Camilo Salary')

    // Should have 12 occurrences
    expect(salaryItems.length).toBe(12)

    // Every salary date should fall on Mon-Fri (never Sat/Sun)
    for (const item of salaryItems) {
      const [year, month, day] = item.date.split('-').map(Number)
      const date = new Date(year, month - 1, day)
      const dayOfWeek = date.getDay()
      expect(
        dayOfWeek >= 1 && dayOfWeek <= 5,
        `${item.date} (day ${dayOfWeek}) should be Mon-Fri`,
      ).toBe(true)
    }

    // Specific known dates:
    // Sep 25 2026 = Friday → Sep 25
    expect(salaryItems[0].date).toBe('2026-09-25')
    // Oct 25 2026 = Sunday → Oct 23 (Friday)
    expect(salaryItems[1].date).toBe('2026-10-23')
    // Nov 25 2026 = Wednesday → Nov 25
    expect(salaryItems[2].date).toBe('2026-11-25')
    // Dec 25 2026 = Friday → Dec 25
    expect(salaryItems[3].date).toBe('2026-12-25')
    // Jan 25 2027 = Monday: keep the scheduled 25th.
    expect(salaryItems[4].date).toBe('2027-01-25')
    // Feb 25 2027 = Thursday → Feb 25
    expect(salaryItems[5].date).toBe('2027-02-25')
    // Mar 25 2027 = Thursday → Mar 25
    expect(salaryItems[6].date).toBe('2027-03-25')
    // Apr 25 2027 = Sunday → Apr 23 (Friday)
    expect(salaryItems[7].date).toBe('2027-04-23')
    // May 25 2027 = Tuesday → May 25
    expect(salaryItems[8].date).toBe('2027-05-25')
    // Jun 25 2027 = Friday → Jun 25
    expect(salaryItems[9].date).toBe('2027-06-25')
    // Jul 25 2027 = Sunday → Jul 23 (Friday)
    expect(salaryItems[10].date).toBe('2027-07-23')
    // Aug 25 2027 = Wednesday → Aug 25
    expect(salaryItems[11].date).toBe('2027-08-25')
  })

  it('does not adjust dates when adjustToPrevFriday is false', () => {
    const state = createTestState()

    if (!state.categories.find((c) => c.group === 'Income')) {
      state.categories.push({
        id: 'cat-income2',
        householdId: state.household.id,
        name: 'Salary',
        group: 'Income',
        order: 0,
        archived: false,
        color: '#2F7D5B',
        icon: 'money',
      })
    }

    if (!state.accounts.length) {
      state.accounts.push({
        id: 'acc-main2',
        householdId: state.household.id,
        name: 'Current',
        institution: '',
        type: 'current',
        currency: 'EUR',
        openingBalanceCents: 0,
        currentBalanceCents: 0,
        holder: '',
        accentColor: '',
        archived: false,
        notes: '',
      })
    }

    const rule: RecurringRule = {
      id: 'test-no-adjust',
      householdId: state.household.id,
      name: 'Partner Salary',
      amountCents: 200_000,
      frequency: 'monthly',
      interval: 1,
      nextDueDate: '2026-10-25',
      accountId: state.accounts[0].id,
      categoryId: state.categories.find((c) => c.group === 'Income')?.id ?? 'cat-income2',
      generateAutomatically: true,
      reminder: true,
      active: true,
      // adjustToPrevFriday is not set (undefined/false)
    }

    state.recurringRules.push(rule)

    const items = buildVisibleItems(state, '2026-10-01', '2026-10-31', new Date('2026-10-01'))
    const salaryItems = items.filter((i) => i.title === 'Partner Salary')

    // Oct 25 2026 is a Sunday — without adjustment, it should stay on the 25th
    expect(salaryItems.length).toBe(1)
    expect(salaryItems[0].date).toBe('2026-10-25')
  })
})
