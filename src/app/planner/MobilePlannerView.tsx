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

const dayTitle = (date: string, locale: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`))

function MobileItem({ item, money, onSelect, onMove }: { item: SimpleItem; money: Props['money']; onSelect: () => void; onMove: () => void }) {
  return <div className="mobile-planner-item" data-kind={item.kind}>
    <button className="mobile-planner-item-main" onClick={onSelect} aria-label={`${item.title}, ${money(item.amountCents)}. Open actions`}>
      <span><strong>{item.title}</strong><small>{item.status}</small></span>
      <b>{item.kind === 'income' ? '+' : '−'}{money(item.amountCents)}</b>
    </button>
    {item.status !== 'completed' ? <button className="mobile-planner-move" onClick={onMove} aria-label={`Move ${item.title} to another date`}><Move size={16} aria-hidden="true" /> Move to date</button> : null}
  </div>
}

function DayDetails({ day, locale, money, onSelectItem, onMoveToDate, onAddDay }: Props & { day: PlanningDay }) {
  return <article className="mobile-planner-day-detail" data-date={day.date}>
    <header><div><small>Day plan</small><h3>{dayTitle(day.date, locale)}</h3></div><strong className={day.closingBalanceCents >= 0 ? 'money-positive' : 'money-negative'}>{money(day.closingBalanceCents)}</strong></header>
    <div className="mobile-day-metrics" aria-live="polite">
      <span><small>Income</small><strong>{money(day.incomeCents)}</strong></span>
      <span><small>Bills</small><strong>{money(day.expenseCents)}</strong></span>
      <span><small>Income − bills</small><strong>{money(day.remainingCents)}</strong></span>
      <span><small>Running balance</small><strong>{money(day.closingBalanceCents)}</strong></span>
    </div>
    <div className="mobile-planner-items">
      {day.items.length ? day.items.map((item) => <MobileItem key={item.id} item={item} money={money} onSelect={() => onSelectItem(item)} onMove={() => onMoveToDate(item)} />) : <p>Nothing planned for this day.</p>}
    </div>
    <footer><button onClick={() => onAddDay(day.date, 'income')}><Plus size={17} /> Add income</button><button onClick={() => onAddDay(day.date, 'bill')}><Plus size={17} /> Add bill</button></footer>
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
      {(['week', 'day', 'month'] as Mode[]).map((entry) => <button key={entry} role="tab" aria-selected={mode === entry} onClick={() => setMode(entry)}>{entry === 'month' ? 'Month overview' : `${entry[0].toUpperCase()}${entry.slice(1)}`}</button>)}
    </div>

    {mode === 'week' ? <>
      <div className="mobile-week-navigation">
        <button disabled={weekIndex === 0} onClick={() => goToWeek(weekIndex - 1)} aria-label="Previous planner week"><ChevronLeft /></button>
        <button onClick={goToday}>Today</button>
        <button disabled={weekIndex === weeks.length - 1} onClick={() => goToWeek(weekIndex + 1)} aria-label="Next planner week"><ChevronRight /></button>
      </div>
      <div className="mobile-week-summary" aria-live="polite">
        <div><small>Financial week</small><h3>{week.label}</h3></div>
        <div><span><small>Opening</small><strong>{money(week.openingBalanceCents)}</strong></span><span><small>Income</small><strong>{money(week.incomeCents)}</strong></span><span><small>Bills</small><strong>{money(week.expenseCents)}</strong></span><span><small>Closing</small><strong>{money(week.closingBalanceCents)}</strong></span></div>
      </div>
      <div className="mobile-week-days">{week.days.map((day) => <button key={day.date} className="mobile-week-day" onClick={() => chooseDay(day)} data-date={day.date}>
        <header><span>{dayTitle(day.date, locale)}</span><b>{day.items.length} {day.items.length === 1 ? 'item' : 'items'}</b></header>
        <div><span>Income <strong>{money(day.incomeCents)}</strong></span><span>Bills <strong>{money(day.expenseCents)}</strong></span><span>Closing <strong>{money(day.closingBalanceCents)}</strong></span></div>
        <small>Open day →</small>
      </button>)}</div>
    </> : null}

    {mode === 'day' && selectedDay ? <DayDetails {...props} day={selectedDay} /> : null}

    {mode === 'month' ? <div className="mobile-month-overview" aria-label="Planner month overview">{allDays.map((day) => <button key={day.date} data-date={day.date} data-negative={day.closingBalanceCents < 0} onClick={() => chooseDay(day)}>
      <span>{new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(`${day.date}T12:00:00`))}</span><strong>{new Date(`${day.date}T12:00:00`).getDate()}</strong><small>+{money(day.incomeCents)}</small><small>−{money(day.expenseCents)}</small><b>{day.items.length}</b>
    </button>)}</div> : null}
  </section>
}
