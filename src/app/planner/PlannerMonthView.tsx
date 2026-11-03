import type { buildMonthCalendar } from '@/domain/home'
import { fromIsoDate, todayIso } from '@/lib/date'

export function PlannerMonthView({ calendar, locale, money, selectedDate, onChooseDay }: {
  calendar: ReturnType<typeof buildMonthCalendar>
  locale: string
  money: (cents: number) => string
  selectedDate: string
  onChooseDay: (date: string) => void
}) {
  const fullDate = (date: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(fromIsoDate(date))
  return <section className="planner-month" aria-label="Monthly financial planner">
    <div className="planner-month-weekdays" aria-hidden="true">{calendar.days.slice(0, 7).map((day) => <span key={day.date}>{new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(fromIsoDate(day.date))}</span>)}</div>
    <div className="planner-month-grid">
      {calendar.days.map((day) => <button key={day.date} className="planner-month-day"
        data-date={day.date} data-outside={!day.inMonth} data-selected={day.date === selectedDate}
        data-today={day.date === todayIso()} aria-label={`Open week for ${fullDate(day.date)}`}
        aria-current={day.date === todayIso() ? 'date' : undefined}
        onClick={() => onChooseDay(day.date)}>
        <span className="planner-month-day-number">{fromIsoDate(day.date).getDate()}</span>
        {day.items.length ? <>
          <span className="planner-month-amounts">
            {day.incomeCents > 0 ? <b className="money-positive">+{money(day.incomeCents)}</b> : null}
            {day.expenseCents > 0 ? <b className="money-negative">−{money(day.expenseCents)}</b> : null}
          </span>
          <span className="planner-month-items">{day.items.slice(0, 2).map((item) => <span key={item.id} data-kind={item.kind}>{item.title}</span>)}</span>
          <span className="planner-month-signals" aria-hidden="true">{day.incomeCents > 0 ? <i data-kind="income" /> : null}{day.expenseCents > 0 ? <i data-kind="bill" /> : null}</span>
          <small className="planner-month-count">{day.items.length} {day.items.length === 1 ? 'item' : 'items'}</small>
        </> : <span className="planner-month-empty" aria-hidden="true">—</span>}
      </button>)}
    </div>
    <p className="planner-month-hint">Select a day to open its week.</p>
  </section>
}
