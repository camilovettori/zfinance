import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonthlyPlannerView } from '@/app/MonthlyPlanner'
import type { PlanningWeek } from '@/domain/planning'

function week(start: string, end: string, label: string): PlanningWeek {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${start}T12:00:00`)
    date.setDate(date.getDate() + index)
    const dateIso = date.toISOString().slice(0, 10)
    return {
      date: dateIso,
      label: dateIso,
      inPeriod: true,
      items: [],
      incomeCents: 0,
      expenseCents: 0,
      remainingCents: 0,
      closingBalanceCents: 0,
    }
  })
  return {
    start,
    end,
    label,
    days,
    incomeCents: 0,
    expenseCents: 0,
    remainingCents: 0,
    plannedSavingsCents: 0,
    afterSavingsCents: 0,
    openingBalanceCents: 0,
    closingBeforeSavingsCents: 0,
    closingBalanceCents: 0,
  }
}

const weeks: PlanningWeek[] = [
  week('2026-07-30', '2026-08-05', 'Week 1'),
  week('2026-08-06', '2026-08-12', 'Week 2'),
  week('2026-08-13', '2026-08-19', 'Week 3'),
]

const money = (cents: number) => `€${(cents / 100).toFixed(2)}`

describe('MonthlyPlannerView current week highlight', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-11T12:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks the week containing today as current and others as not', () => {
    const { container } = render(<MonthlyPlannerView weeks={weeks} locale="en-US" money={money} monthly />)
    const sections = container.querySelectorAll('.planning-week')
    expect(sections[0].getAttribute('data-current-week')).toBe('false')
    expect(sections[1].getAttribute('data-current-week')).toBe('true')
    expect(sections[2].getAttribute('data-current-week')).toBe('false')
    expect(screen.getByText('● Current week')).toBeTruthy()
  })

  it('marks the day column matching today as today', () => {
    const { container } = render(<MonthlyPlannerView weeks={weeks} locale="en-US" money={money} monthly />)
    const todayColumn = container.querySelector('[data-date="2026-08-11"]')
    expect(todayColumn?.getAttribute('data-today')).toBe('true')
    const otherColumn = container.querySelector('[data-date="2026-08-10"]')
    expect(otherColumn?.getAttribute('data-today')).toBe('false')
  })
})
