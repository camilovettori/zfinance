import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { GripVertical, Plus } from 'lucide-react'
import type { SimpleItem } from '@/domain/home'
import type { FinancialGoal } from '@/domain/model'
import type { PlannerCycleSummary, PlanningDay, PlanningWeek } from '@/domain/planning'
import { isIsoBetween, todayIso } from '@/lib/date'

type MoneyFormatter = (amountCents: number) => string

type PlanningItemCardProps = {
  item: SimpleItem
  money: MoneyFormatter
  interactive?: boolean
  overlay?: boolean
  onSelect?: (item: SimpleItem) => void
}

function PlanningItemCard({ item, money, interactive = false, overlay = false, onSelect }: PlanningItemCardProps) {
  const completed = item.status === 'completed'
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: { item },
    disabled: !interactive || completed || overlay,
  })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
  return (
    <div
      ref={setNodeRef}
      className={`planning-line${interactive ? ' planning-line-interactive' : ''}${overlay ? ' planning-line-overlay' : ''}`}
      data-kind={item.kind}
      data-completed={completed}
      data-dragging={isDragging}
      style={style}
      title={completed ? 'Completed items can be changed from Edit.' : interactive ? 'Drag to another day or click for actions' : undefined}
      {...attributes}
      {...listeners}
    >
      {interactive ? <GripVertical className="planner-drag-handle print-hide" size={13} aria-hidden="true" /> : null}
      {interactive ? <button type="button" className="planner-item-main" onClick={() => onSelect?.(item)} aria-label={`${item.title}, ${money(item.amountCents)}. Open actions`}>
          <span>{item.title}</span>
          <strong>{item.kind === 'income' ? '+' : '−'}{money(item.amountCents)}</strong>
        </button> : <><span>{item.title}</span><strong>{item.kind === 'income' ? '+' : '−'}{money(item.amountCents)}</strong></>}
    </div>
  )
}

type PlanningDayColumnProps = {
  day: PlanningDay
  locale: string
  money: MoneyFormatter
  interactive: boolean
  onSelect?: (item: SimpleItem) => void
  onAddDay?: (date: string) => void
}

function PlanningDayColumn({ day, locale, money, interactive, onSelect, onAddDay }: PlanningDayColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: `planner-day:${day.date}`, data: { date: day.date }, disabled: !interactive })
  return (
    <article
      ref={setNodeRef}
      className={`planning-day${day.inPeriod ? '' : ' outside-report-period'}${isOver ? ' planner-drop-target' : ''}`}
      data-outside={!day.inPeriod}
      data-date={day.date}
      data-today={day.date === todayIso()}
      onDoubleClick={() => interactive && onAddDay?.(day.date)}
    >
      <header><strong>{new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(`${day.date}T12:00:00`))}</strong><span>{new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(`${day.date}T12:00:00`))}</span></header>
      <div className="planning-day-items">
        {day.items.length
          ? day.items.map((item) => <PlanningItemCard key={item.id} item={item} money={money} interactive={interactive} onSelect={onSelect} />)
          : <em>Nothing planned</em>}
        {interactive ? <button type="button" className="planner-day-add print-hide" onClick={() => onAddDay?.(day.date)} aria-label={`Add item on ${day.date}`}><Plus size={12} /> Add</button> : null}
      </div>
      <footer><span>Income <b>{money(day.incomeCents)}</b></span><span>Bills <b>{money(day.expenseCents)}</b></span><span>Income - bills <b className={day.remainingCents >= 0 ? 'money-positive' : 'money-negative'}>{money(day.remainingCents)}</b></span><span>Running balance <b className={day.closingBalanceCents >= 0 ? 'money-positive' : 'money-negative'}>{money(day.closingBalanceCents)}</b></span></footer>
    </article>
  )
}

export type MonthlyPlannerViewProps = {
  weeks: PlanningWeek[]
  locale: string
  money: MoneyFormatter
  monthly?: boolean
  interactive?: boolean
  onMove?: (item: SimpleItem, targetDate: string) => void
  onSelect?: (item: SimpleItem) => void
  onAddDay?: (date: string) => void
}

export function MonthlyPlannerView({ weeks, locale, money, monthly = false, interactive = false, onMove, onSelect, onAddDay }: MonthlyPlannerViewProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor))
  const [activeItem, setActiveItem] = useState<SimpleItem | null>(null)
  const handleStart = (event: DragStartEvent) => setActiveItem(event.active.data.current?.item as SimpleItem | null)
  const handleEnd = (event: DragEndEvent) => {
    const item = event.active.data.current?.item as SimpleItem | undefined
    const date = event.over?.data.current?.date as string | undefined
    setActiveItem(null)
    if (item && date && item.date !== date) onMove?.(item, date)
  }
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const currentWeek = listRef.current?.querySelector('[data-current-week="true"]')
    currentWeek?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [weeks])
  const content = (
    <div className="planning-week-list" ref={listRef}>
      {weeks.map((week, weekIndex) => {
        const isCurrentWeek = isIsoBetween(todayIso(), week.start, week.end)
        return (
        <section className="planning-week" key={week.start} data-week-start={week.start} data-current-week={isCurrentWeek}>
          <div className="planning-week-heading"><div><small>{isCurrentWeek ? '● Current week' : monthly ? `Week ${weekIndex + 1}` : 'Weekly plan'}</small><h3>{week.label}</h3></div><span className={week.closingBalanceCents >= 0 ? 'money-positive' : 'money-negative'}>{money(week.openingBalanceCents)} opening → {money(week.closingBalanceCents)} closing</span></div>
          <div className="planning-day-grid">
            {week.days.map((day) => <PlanningDayColumn key={day.date} day={day} locale={locale} money={money} interactive={interactive} onSelect={onSelect} onAddDay={onAddDay} />)}
          </div>
          <div className="planning-week-totals">
            <span><small>Opening balance</small><strong>{money(week.openingBalanceCents)}</strong></span>
            <span><small>Income</small><strong>{money(week.incomeCents)}</strong></span>
            <span><small>Total bills</small><strong>{money(week.expenseCents)}</strong></span>
            <span><small>Income minus bills</small><strong>{money(week.remainingCents)}</strong></span>
            <span><small>Savings allocation</small><strong>{money(week.plannedSavingsCents)}</strong></span>
            <span><small>Closing balance</small><strong className={week.closingBalanceCents >= 0 ? 'money-positive' : 'money-negative'}>{money(week.closingBalanceCents)}</strong></span>
          </div>
        </section>
        )
      })}
    </div>
  )
  if (!interactive) return content
  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleStart}
      onDragCancel={() => setActiveItem(null)}
      onDragEnd={handleEnd}
      accessibility={{ screenReaderInstructions: { draggable: 'Press space to pick up an item. Use the arrow keys to move it between days, then press space to drop. Use the item Move action for a date picker alternative.' } }}
    >
      {content}
      <DragOverlay dropAnimation={null}>{activeItem ? <PlanningItemCard item={activeItem} money={money} overlay /> : null}</DragOverlay>
    </DndContext>
  )
}

type SavingsSummaryProps = {
  accumulatedCents: number
  actualCents: number
  plannedCents: number
  periodLabel: string
  goals: FinancialGoal[]
  goalPlan: (monthlyContributionCents: number) => number
  money: MoneyFormatter
}

export function PlannerSavingsSummary({ accumulatedCents, actualCents, plannedCents, periodLabel, goals, goalPlan, money }: SavingsSummaryProps) {
  return <div className="planning-savings-summary">
    <div className="planning-savings-head"><div><small>Savings accumulated</small><strong>{money(accumulatedCents)}</strong></div><div><small>Saved in this {periodLabel}</small><strong>{money(actualCents)}</strong></div><div><small>Planned contribution</small><strong>{money(plannedCents)}</strong></div></div>
    {goals.length ? <div className="planning-goals">{goals.map((goal) => <div key={goal.id}><span><strong>{goal.name}</strong><small>{money(goal.currentCents)} of {money(goal.targetCents)} accumulated</small></span><b>{money(goalPlan(goal.monthlyContributionCents))} planned</b></div>)}</div> : <p>No savings goals configured yet.</p>}
  </div>
}

type CalendarReportSummaryProps = {
  mode: 'calendar-report'
  monthName: string
  calendarMonthLabel: string
  plannerCycleLabel: string
  plannerCycleEndLabel: string
  incomeCents: number
  expenseCents: number
  remainingCents: number
  openingBalanceCents: number
  actualSavingsCents: number
  closingBalanceCents: number
  distribution: Array<{ categoryId: string; categoryName: string; amountCents: number }>
  money: MoneyFormatter
}

type PlannerCycleSummaryProps = {
  mode: 'planner-cycle'
  cycleLabel: string
  totals: PlannerCycleSummary
  money: MoneyFormatter
}

type MonthlySummaryProps = CalendarReportSummaryProps | PlannerCycleSummaryProps

export function MonthlyPlannerSummary(props: MonthlySummaryProps) {
  if (props.mode === 'planner-cycle') {
    const { cycleLabel, totals, money } = props
    return <section className="monthly-grand-summary planner-cycle-summary">
      <div className="monthly-summary-title"><div><small>End of planner</small><h3>Planner cycle summary</h3><p>{cycleLabel}</p></div><strong className={totals.closingBalanceCents >= 0 ? 'money-positive' : 'money-negative'}>{money(totals.closingBalanceCents)}</strong></div>
      <div className="monthly-summary-metrics">
        <span><small>Opening balance</small><strong>{money(totals.openingBalanceCents)}</strong></span>
        <span><small>Total cycle income</small><strong className="money-positive">{money(totals.incomeCents)}</strong></span>
        <span><small>Total cycle bills</small><strong className="money-negative">{money(totals.expenseCents)}</strong></span>
        <span><small>Income minus bills</small><strong className={totals.incomeMinusBillsCents >= 0 ? 'money-positive' : 'money-negative'}>{money(totals.incomeMinusBillsCents)}</strong></span>
        <span><small>Savings allocation</small><strong>{money(totals.savingsAllocationCents)}</strong></span>
        <span><small>Cycle closing balance</small><strong className={totals.closingBalanceCents >= 0 ? 'money-positive' : 'money-negative'}>{money(totals.closingBalanceCents)}</strong></span>
      </div>
      <p className="monthly-summary-conclusion">{totals.closingBalanceCents >= 0 ? `After all income and bills in this financial cycle, ${money(totals.closingBalanceCents)} remains.` : `After all income and bills in this financial cycle, the planner is ${money(Math.abs(totals.closingBalanceCents))} short.`}</p>
    </section>
  }
  const { monthName, calendarMonthLabel, plannerCycleLabel, plannerCycleEndLabel, incomeCents, expenseCents, remainingCents, openingBalanceCents, actualSavingsCents, closingBalanceCents, distribution, money } = props
  const maximum = Math.max(1, incomeCents, expenseCents)
  return <section className="monthly-grand-summary">
    <div className="monthly-summary-title"><div><small>End of planner</small><h3>Monthly grand summary</h3><p>Calendar month: {calendarMonthLabel}</p><p>Planner cycle: {plannerCycleLabel}</p></div><strong className={closingBalanceCents >= 0 ? 'money-positive' : 'money-negative'}>{closingBalanceCents >= 0 ? `${money(closingBalanceCents)} cycle closing` : `${money(Math.abs(closingBalanceCents))} short at cycle close`}</strong></div>
    <div className="monthly-summary-metrics">
      <span><small>Calendar month income</small><strong className="money-positive">{money(incomeCents)}</strong></span>
      <span><small>Calendar month expenses</small><strong className="money-negative">{money(expenseCents)}</strong></span>
      <span><small>Calendar month result</small><strong className={remainingCents >= 0 ? 'money-positive' : 'money-negative'}>{money(remainingCents)}</strong></span>
      <span><small>Opening balance</small><strong>{money(openingBalanceCents)}</strong></span>
      <span><small>Saved this month</small><strong className="money-positive">{money(actualSavingsCents)}</strong></span>
      <span><small>Planner cycle closing balance</small><strong className={closingBalanceCents >= 0 ? 'money-positive' : 'money-negative'}>{money(closingBalanceCents)}</strong></span>
    </div>
    <div className="monthly-summary-body">
      <div className="monthly-income-expense"><h4>Income and expenses</h4>{([['Income', incomeCents, 'income'], ['Expenses', expenseCents, 'expense']] as const).map(([name, value, kind]) => <div key={name}><span><b>{name}</b><strong>{money(value)}</strong></span><i><em data-kind={kind} style={{ width: `${value / maximum * 100}%` } as CSSProperties} /></i></div>)}</div>
      <div className="monthly-category-summary"><h4>Expenses by category</h4>{distribution.length ? distribution.slice(0, 8).map((entry) => { const percent = expenseCents > 0 ? Math.round(entry.amountCents / expenseCents * 100) : 0; return <div key={entry.categoryId}><span><b>{entry.categoryName}</b><small>{percent}%</small><strong>{money(entry.amountCents)}</strong></span><i><em style={{ width: `${percent}%` }} /></i></div> }) : <p>No expenses in this month.</p>}</div>
    </div>
    <p className="monthly-summary-conclusion">{remainingCents >= 0 ? `${monthName} income exceeds ${monthName} bills by ${money(remainingCents)}.` : `${monthName} bills exceed ${monthName} income by ${money(Math.abs(remainingCents))}.`} {closingBalanceCents >= 0 ? `After completing the financial week through ${plannerCycleEndLabel}, ${money(closingBalanceCents)} remains.` : `After completing the financial week through ${plannerCycleEndLabel}, the planner is ${money(Math.abs(closingBalanceCents))} short.`}</p>
  </section>
}
