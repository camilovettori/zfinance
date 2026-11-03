import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { getISOWeek } from 'date-fns'
import { fromIsoDate } from '@/lib/date'

export function PlannerWeekNavigation({ start, label, onPrevious, onNext, onToday, view = 'week' }: {
  view?: 'week' | 'month'
  start: string
  label: string
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
}) {
  return <nav className="planner-week-navigation print-hide" aria-label={`Planner ${view} navigation`}>
    <button className="planner-week-arrow" onClick={onPrevious} aria-label={`Previous planner ${view}`} title={`Previous ${view}`}><ChevronLeft size={22} aria-hidden="true" /></button>
    <div className="planner-week-selection" aria-live="polite" aria-atomic="true">
      <span><CalendarDays size={15} aria-hidden="true" />{view === 'month' ? 'Month overview' : `Week ${getISOWeek(fromIsoDate(start))}`}</span>
      <strong>{label}</strong>
    </div>
    <button className="planner-week-arrow" onClick={onNext} aria-label={`Next planner ${view}`} title={`Next ${view}`}><ChevronRight size={22} aria-hidden="true" /></button>
    <button className="planner-week-today" onClick={onToday}>Today</button>
  </nav>
}
