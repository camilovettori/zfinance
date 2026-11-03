import { CalendarDays, CalendarRange, WalletCards } from 'lucide-react'
import type { buildCalendarForecast } from '@/domain/calendar-forecast'
import { fromIsoDate } from '@/lib/date'

export function PlannerForecastSummary({ forecast, locale, money }: {
  forecast: ReturnType<typeof buildCalendarForecast>
  locale: string
  money: (cents: number) => string
}) {
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(fromIsoDate(iso))
  return <section className="planner-forecast-summary" aria-label="Balance forecast summary">
    <div className="planner-forecast-title"><h3>Balance outlook</h3><p>Based on recorded income, bills and savings plans. Unrecorded spending is not included.</p></div>
    <div className="planner-forecast-cards">
      {[
        { label: 'Available now', date: forecast.asOf, amount: forecast.availableNowCents, Icon: WalletCards },
        { label: 'End of month', date: forecast.monthEnd.date, amount: forecast.monthEnd.balanceCents, Icon: CalendarDays },
        { label: 'End of year', date: forecast.yearEnd.date, amount: forecast.yearEnd.balanceCents, Icon: CalendarRange },
      ].map(({ label, date: iso, amount, Icon }) => <article key={label} aria-label={label}>
        <span><Icon size={18} aria-hidden="true" />{label}</span>
        <strong className={amount >= 0 ? 'money-positive' : 'money-negative'}>{money(amount)}</strong>
        <small>{date(iso)}</small>
      </article>)}
    </div>
  </section>
}
