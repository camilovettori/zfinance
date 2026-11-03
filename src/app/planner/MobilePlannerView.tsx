import { useState } from 'react'
import { getISOWeek } from 'date-fns'
import { Check, ChevronRight, Move, Plus } from 'lucide-react'
import type { SimpleItem } from '@/domain/home'
import type { PlanningDay, PlanningWeek } from '@/domain/planning'
import { fromIsoDate, todayIso } from '@/lib/date'

type Mode = 'week' | 'day'
type Props = {
  weeks: PlanningWeek[]
  weekDate: string
  onChooseDate: (date: string) => void
  onMonthView: () => void
  locale: string
  money: (cents: number) => string
  onSelectItem: (item: SimpleItem) => void
  onMoveToDate: (item: SimpleItem) => void
  onCompleteItem?: (item: SimpleItem) => void | Promise<void>
  onAddDay: (date: string, kind: 'income' | 'bill') => void
}

const dayTitle = (date: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`))
const dayNumber = (date: string) => new Date(`${date}T12:00:00`).getDate()
const weekdayLetter = (date: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(`${date}T12:00:00`))

function MobileItem({ item, money, onSelect, onMove, onComplete }: { item: SimpleItem; money: Props['money']; onSelect: () => void; onMove: () => void; onComplete?: Props['onCompleteItem'] }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const complete = async () => {
    if (!onComplete || saving) return
    setSaving(true)
    setError('')
    try { await onComplete(item) } catch { setError('Could not save. Please try again.') } finally { setSaving(false) }
  }
  return <div className="mobile-planner-item" data-kind={item.kind} data-status={item.status}>
    <button className="mobile-planner-item-main" onClick={onSelect} aria-label={`${item.title}, ${money(item.amountCents)}. Open actions`}>
      <span><strong>{item.title}</strong><small>{item.status}</small></span>
      <b>{item.kind === 'income' ? '+' : '−'}{money(item.amountCents)}</b>
    </button>
    {item.status !== 'completed' ? <div className="mobile-planner-item-actions">
      <button className="mobile-planner-move" onClick={onMove} aria-label={`Move ${item.title} to another date`}><Move size={16} aria-hidden="true" /> Move to date</button>
      {onComplete ? <button className="mobile-planner-complete" disabled={saving} onClick={() => void complete()} aria-label={`Mark ${item.title} ${item.kind === 'income' ? 'received' : 'paid'}`}><Check size={16} aria-hidden="true" />{saving ? 'Saving…' : item.kind === 'income' ? 'Received' : 'Paid'}</button> : null}
    </div> : <small className="mobile-planner-completed"><Check size={14} aria-hidden="true" />{item.kind === 'income' ? 'Received' : 'Paid'}</small>}
    {error ? <p className="mobile-planner-action-error" role="alert">{error}</p> : null}
  </div>
}

function DayDetails({ day, locale, money, onSelectItem, onMoveToDate, onAddDay, onCompleteItem }: Props & { day: PlanningDay }) {
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
        ? day.items.map((item) => <MobileItem key={item.id} item={item} money={money} onSelect={() => onSelectItem(item)} onMove={() => onMoveToDate(item)} onComplete={onCompleteItem} />)
        : <p>Nothing planned for this day.</p>}
    </div>
    <footer>
      <button onClick={() => onAddDay(day.date, 'income')}><Plus size={17} /> Add income</button>
      <button onClick={() => onAddDay(day.date, 'bill')}><Plus size={17} /> Add bill</button>
    </footer>
  </article>
}

export function MobilePlannerView(props: Props) {
  const { weeks, locale, money, weekDate } = props
  const weekIndex = Math.max(0, weeks.findIndex((week) => weekDate >= week.start && weekDate <= week.end))
  const [mode, setMode] = useState<Mode>('week')
  const week = weeks[weekIndex]
  const selectedDay = week?.days.find((day) => day.date === weekDate) ?? week?.days[0]

  const chooseDay = (day: PlanningDay) => {
    props.onChooseDate(day.date)
    setMode('day')
  }

  if (!week) return <p className="mobile-planner-empty">No planning weeks in this cycle.</p>

  return <section className="mobile-planner" aria-label="Mobile financial planner">
    <div className="mobile-planner-tabs" role="tablist" aria-label="Planner view">
      {(['week', 'day', 'month'] as const).map((entry) => <button
        key={entry}
        role="tab"
        aria-selected={mode === entry}
        onClick={() => entry === 'month' ? props.onMonthView() : setMode(entry)}
      >{entry === 'month' ? 'Month' : `${entry[0].toUpperCase()}${entry.slice(1)}`}</button>)}
    </div>

    {mode === 'week' ? <>
      <div className="mobile-week-balance-card">
        <small>{todayIso() >= week.start && todayIso() <= week.end ? 'Current week · ' : ''}Week {getISOWeek(fromIsoDate(week.start))}</small>
        <div><span><small>Opening</small><strong>{money(week.openingBalanceCents)}</strong></span><ChevronRight size={18} aria-hidden="true" /><span><small>End of week</small><strong className={week.closingBalanceCents >= 0 ? 'money-positive' : 'money-negative'}>{money(week.closingBalanceCents)}</strong></span></div>
        <p><span>Income <b>{money(week.incomeCents)}</b></span><span>Bills <b>{money(week.expenseCents)}</b></span></p>
      </div>

      {/* One continuous rail: the running balance lives on the spine, so a dip
          below zero reads without adding up seven separate cards. */}
      <ol className="mobile-week-rail" aria-label={`Days of ${week.label}`}>
        {week.days.map((day, index) => <li key={day.date} data-last={index === week.days.length - 1}>
          <span className="mobile-rail-node" data-today={day.date === todayIso()} aria-hidden="true">{dayNumber(day.date)}</span>
          <button
            className="mobile-week-day"
            onClick={() => chooseDay(day)}
            data-date={day.date}
            data-selected={day.date === weekDate}
            data-negative={day.closingBalanceCents < 0}
          >
            <header>
              <span>{dayTitle(day.date, locale)}<small>{day.date === todayIso() ? 'Today · ' : ''}{day.items.length ? `${day.items.length} ${day.items.length === 1 ? 'item' : 'items'}` : 'Free day'}</small></span>
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
          onClick={() => props.onChooseDate(day.date)}
        >
          <small>{weekdayLetter(day.date, locale)}</small>
          <strong>{dayNumber(day.date)}</strong>
        </button>)}
      </div>
      <DayDetails {...props} day={selectedDay} />
    </> : null}


  </section>
}
