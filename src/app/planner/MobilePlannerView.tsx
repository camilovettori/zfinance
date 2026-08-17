import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Move, Plus } from 'lucide-react'
import type { SimpleItem } from '@/domain/home'
import type { PlanningDay, PlanningWeek } from '@/domain/planning'
import { todayIso } from '@/lib/date'

type Mode = 'week' | 'day' | 'month'
type Props = {
  weeks: PlanningWeek[]
  locale: string
  money: (cents: number) => string
  onSelectItem: (item: SimpleItem) => void
  onMoveToDate: (item: SimpleItem) => void
  onAddDay: (date: string, kind: 'income' | 'bill') => void
}

const dayTitle = (date: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`))
const dayNumber = (date: string) => new Date(`${date}T12:00:00`).getDate()
const weekdayLetter = (date: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(`${date}T12:00:00`))

function MobileItem({ item, money, onSelect, onMove }: { item: SimpleItem; money: Props['money']; onSelect: () => void; onMove: () => void }) {
  return <div className="mobile-planner-item" data-kind={item.kind} data-status={item.status}>
    <button className="mobile-planner-item-main" onClick={onSelect} aria-label={`${item.title}, ${money(item.amountCents)}. Open actions`}>
      <span><strong>{item.title}</strong><small>{item.status}</small></span>
      <b>{item.kind === 'income' ? '+' : '−'}{money(item.amountCents)}</b>
    </button>
    {item.status !== 'completed'
      ? <button className="mobile-planner-move" onClick={onMove} aria-label={`Move ${item.title} to another date`}><Move size={16} aria-hidden="true" /> Move to date</button>
      : null}
  </div>
}

function DayDetails({ day, locale, money, onSelectItem, onMoveToDate, onAddDay }: Props & { day: PlanningDay }) {
  return <article className="mobile-planner-day-detail" data-date={day.date}>
    <header>
      <div><small>Day plan</small><h3>{dayTitle(day.date, locale)}</h3></div>
      <div className="mobile-day-running">
        <small>Running</small>
        <strong className={day.closingBalanceCents >= 0 ? 'money-positive' : 'money-negative'}>{money(day.closingBalanceCents)}</strong>
      </div>
    </header>
    <div className="mobile-day-metrics" aria-live="polite">
      <span><small>Income</small><strong className="money-positive">{money(day.incomeCents)}</strong></span>
      <span><small>Bills</small><strong className="money-negative">{money(day.expenseCents)}</strong></span>
    </div>
    <div className="mobile-planner-items">
      {day.items.length
        ? day.items.map((item) => <MobileItem key={item.id} item={item} money={money} onSelect={() => onSelectItem(item)} onMove={() => onMoveToDate(item)} />)
        : <p>Nothing planned for this day.</p>}
    </div>
    <footer>
      <button onClick={() => onAddDay(day.date, 'income')}><Plus size={17} /> Add income</button>
      <button onClick={() => onAddDay(day.date, 'bill')}><Plus size={17} /> Add bill</button>
    </footer>
  </article>
}

export function MobilePlannerView(props: Props) {
  const { weeks, locale, money } = props
  // Start at the first week of the visible planner cycle. "Today" remains an explicit action;
  // tying initial selection to the wall clock made historic/monthly cycles jump unpredictably.
  const initialWeek = 0
  const [mode, setMode] = useState<Mode>('week')
  const [weekIndex, setWeekIndex] = useState(initialWeek)
  const [selectedDate, setSelectedDate] = useState(weeks[initialWeek]?.days[0]?.date ?? '')
  const week = weeks[Math.min(weekIndex, Math.max(0, weeks.length - 1))]
  const allDays = useMemo(() => weeks.flatMap((entry) => entry.days), [weeks])
  const selectedDay = allDays.find((day) => day.date === selectedDate) ?? week?.days[0]

  const chooseDay = (day: PlanningDay) => {
    setSelectedDate(day.date)
    setMode('day')
  }
  const goToWeek = (index: number) => {
    const next = Math.max(0, Math.min(weeks.length - 1, index))
    setWeekIndex(next)
    setSelectedDate(weeks[next]?.days[0]?.date ?? '')
  }
  const goToday = () => {
    const todayWeek = weeks.findIndex((entry) => entry.days.some((day) => day.date === todayIso()))
    goToWeek(todayWeek >= 0 ? todayWeek : 0)
  }

  if (!week) return <p className="mobile-planner-empty">No planning weeks in this cycle.</p>

  return <section className="mobile-planner" aria-label="Mobile financial planner">
    <div className="mobile-planner-tabs" role="tablist" aria-label="Planner view">
      {(['week', 'day', 'month'] as Mode[]).map((entry) => <button
        key={entry}
        role="tab"
        aria-selected={mode === entry}
        onClick={() => setMode(entry)}
      >{entry === 'month' ? 'Month overview' : `${entry[0].toUpperCase()}${entry.slice(1)}`}</button>)}
    </div>

    {mode === 'week' ? <>
      <div className="mobile-week-navigation">
        <button disabled={weekIndex === 0} onClick={() => goToWeek(weekIndex - 1)} aria-label="Previous planner week"><ChevronLeft /></button>
        <div className="mobile-week-heading">
          <strong>{week.label}</strong>
          <small>Opens {money(week.openingBalanceCents)} · closes {money(week.closingBalanceCents)}</small>
        </div>
        <button disabled={weekIndex === weeks.length - 1} onClick={() => goToWeek(weekIndex + 1)} aria-label="Next planner week"><ChevronRight /></button>
      </div>
      <button className="mobile-week-today" onClick={goToday}>Jump to today</button>

      {/* One continuous rail: the running balance lives on the spine, so a dip
          below zero reads without adding up seven separate cards. */}
      <ol className="mobile-week-rail" aria-label={`Days of ${week.label}`}>
        {week.days.map((day, index) => <li key={day.date} data-last={index === week.days.length - 1}>
          <span className="mobile-rail-node" data-today={day.date === todayIso()} aria-hidden="true">{dayNumber(day.date)}</span>
          <button
            className="mobile-week-day"
            onClick={() => chooseDay(day)}
            data-date={day.date}
            data-negative={day.closingBalanceCents < 0}
          >
            <header>
              <span>{dayTitle(day.date, locale)}</span>
              <b className={day.closingBalanceCents < 0 ? 'money-negative' : 'money-positive'}>{money(day.closingBalanceCents)}</b>
            </header>
            {day.items.length ? <div className="mobile-rail-items">
              {day.items.slice(0, 3).map((item) => <span key={item.id} data-kind={item.kind} data-status={item.status}>
                <i aria-hidden="true" />
                <small>{item.title}</small>
                <b>{item.kind === 'income' ? '+' : '−'}{money(item.amountCents)}</b>
              </span>)}
              {day.items.length > 3 ? <small className="mobile-rail-more">+ {day.items.length - 3} more</small> : null}
            </div> : <small className="mobile-rail-empty">Nothing planned</small>}
            {day.closingBalanceCents < 0 ? <strong className="mobile-rail-warning">Balance goes negative on this day</strong> : null}
          </button>
        </li>)}
      </ol>
    </> : null}

    {mode === 'day' && selectedDay ? <>
      <div className="mobile-day-strip" role="tablist" aria-label="Day of week">
        {week.days.map((day) => <button
          key={day.date}
          role="tab"
          aria-selected={day.date === selectedDay.date}
          data-date={day.date}
          onClick={() => setSelectedDate(day.date)}
        >
          <small>{weekdayLetter(day.date, locale)}</small>
          <strong>{dayNumber(day.date)}</strong>
        </button>)}
      </div>
      <DayDetails {...props} day={selectedDay} />
    </> : null}

    {mode === 'month' ? <div className="mobile-month-overview" aria-label="Planner month overview">
      {allDays.map((day) => <button
        key={day.date}
        data-date={day.date}
        data-negative={day.closingBalanceCents < 0}
        data-today={day.date === todayIso()}
        onClick={() => chooseDay(day)}
        aria-label={`${dayTitle(day.date, locale)}, closing ${money(day.closingBalanceCents)}`}
      >
        <strong>{dayNumber(day.date)}</strong>
        <i aria-hidden="true" data-flow={day.incomeCents > 0 ? 'income' : day.expenseCents > 0 ? 'bills' : 'none'} />
      </button>)}
    </div> : null}
  </section>
}
