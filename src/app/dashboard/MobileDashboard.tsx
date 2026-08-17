import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { formatSimpleCurrency, type SimpleItem } from '@/domain/home'
import type { AppState } from '@/domain/model'
import { fromIsoDate } from '@/lib/date'
import { buildMobileDashboardModel } from './mobile-dashboard-model'

type Props = {
  state: AppState
  referenceDate?: Date
  onEditItem(item: SimpleItem): void
  onAddIncome(): void
  onAddBill(): void
  /** Marks an item paid/received in place. Falls back to onEditItem when absent. */
  onCompleteItem?(item: SimpleItem): void | Promise<void>
  /** Opens the planner on a given day. Absent = day rail is not tappable. */
  onOpenDay?(dateIso: string): void
}

const WEEKDAY_LETTER = (dateIso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(fromIsoDate(dateIso))

export function MobileDashboard({
  state,
  referenceDate = new Date(),
  onEditItem,
  onAddIncome,
  onAddBill,
  onCompleteItem,
  onOpenDay,
}: Props) {
  const model = buildMobileDashboardModel(state, referenceDate)
  const hidden = state.settings.hideSensitiveValues || state.settings.privacyMode
  const money = (amountCents: number) =>
    formatSimpleCurrency(amountCents, state.settings.locale, state.settings.currency, hidden)
  const signedMoney = (amountCents: number, kind: 'income' | 'bill') =>
    hidden ? '••••' : `${kind === 'income' ? '+' : '−'}${money(Math.abs(amountCents))}`

  // Optimistic ticks: the domain write is async, the tap must feel instant.
  const [pending, setPending] = useState<string[]>([])
  const complete = async (item: SimpleItem) => {
    if (!onCompleteItem) return onEditItem(item)
    setPending((current) => [...current, item.id])
    try {
      await onCompleteItem(item)
    } finally {
      setPending((current) => current.filter((id) => id !== item.id))
    }
  }

  const horizon = model.horizon.slice(0, 7)
  const today = model.horizon[0]
  const todayItems = today?.items ?? []
  const todayOutstanding = todayItems.filter((item) => item.status !== 'completed')

  // Everything already owed before the next income lands: the reason
  // "safe to spend" is smaller than the raw balance.
  const committedCents = Math.max(0, model.availableNowCents - model.safeToSpendCents)
  const freePercent = model.availableNowCents > 0
    ? Math.max(4, Math.min(96, Math.round((model.safeToSpendCents / model.availableNowCents) * 100)))
    : 4
  const maxDayFlow = Math.max(1, ...horizon.map((event) => Math.max(event.incomeCents, event.billsCents)))
  const closingCents = horizon.length ? horizon[horizon.length - 1].balanceAfterCents : model.availableNowCents

  return <section className="mobile-dashboard" aria-label="Mobile household dashboard">
    <header className="mobile-dashboard-header">
      <div><p>HomeCoin</p><h1>{state.household.name}</h1></div>
      <time dateTime={model.todayIso}>
        {new Intl.DateTimeFormat(state.settings.locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(fromIsoDate(model.todayIso))}
      </time>
    </header>

    <article className="mobile-safe-card" data-tone={model.tone}>
      <p>Safe to spend {model.safeToSpendUntilLabel}</p>
      <strong className={model.safeToSpendCents < 0 ? 'money-negative' : ''}>{money(model.safeToSpendCents)}</strong>
      <div className="mobile-safe-bar" role="presentation">
        <span style={{ width: `${freePercent}%` }} />
        <span />
      </div>
      <footer>
        <span><small>Committed first</small><b className="money-negative">{money(committedCents)}</b></span>
        <span>
          <small>{model.nextIncome ? 'Then income' : 'No income scheduled'}</small>
          <b className="money-positive">{model.nextIncome ? signedMoney(model.nextIncome.totalCents, 'income') : '—'}</b>
        </span>
      </footer>
    </article>

    <article className="mobile-today-card">
      <header>
        <div><p>Due today</p><h2>{today?.dayLabel ?? 'Today'}</h2></div>
        <span>{todayOutstanding.length} left of {todayItems.length}</span>
      </header>
      {todayItems.length ? <ul className="mobile-today-list">
        {todayItems.map((item) => {
          const category = state.categories.find((candidate) => candidate.id === item.categoryId)
          const done = item.status === 'completed' || pending.includes(item.id)
          return <li key={item.id} data-kind={item.kind} data-done={done}>
            <button
              className="mobile-item-status"
              onClick={() => void complete(item)}
              disabled={done}
              aria-pressed={done}
              aria-label={`Mark ${item.title} ${item.kind === 'income' ? 'received' : 'paid'}`}
            >
              <span aria-hidden="true">{done ? <Check size={14} strokeWidth={3} /> : null}</span>
            </button>
            <button className="mobile-item-main" onClick={() => onEditItem(item)}>
              <strong>{item.title}</strong>
              <small>{category ? `${category.name} · ` : ''}{done ? (item.kind === 'income' ? 'received' : 'paid') : 'planned'}</small>
            </button>
            <b className={item.kind === 'income' ? 'money-positive' : ''}>{signedMoney(item.amountCents, item.kind)}</b>
          </li>
        })}
      </ul> : <p className="mobile-today-empty">Nothing due today</p>}
    </article>

    <article className="mobile-horizon-card">
      <header><div><p>Next seven days</p><h2>{model.currentWeek.label}</h2></div></header>
      <div className="mobile-horizon-spark">
        {horizon.map((event) => {
          const netCents = event.netCents
          const height = Math.max(6, Math.round((Math.abs(netCents) / maxDayFlow) * 44))
          const Tag = onOpenDay ? 'button' : 'div'
          return <Tag
            key={event.date}
            className="mobile-horizon-day"
            data-date={event.date}
            data-today={event.isToday}
            data-negative={event.isNegative}
            {...(onOpenDay ? { onClick: () => onOpenDay(event.date), 'aria-label': `${event.dayLabel}, balance ${money(event.balanceAfterCents)}` } : {})}
          >
            <span className="mobile-horizon-bar" style={{ height: `${height}px` }} data-direction={netCents >= 0 ? 'in' : 'out'} />
            <small>{WEEKDAY_LETTER(event.date, state.settings.locale)}</small>
          </Tag>
        })}
      </div>
      <footer>
        <span>Balance in seven days</span>
        <strong className={closingCents < 0 ? 'money-negative' : 'money-positive'}>{money(closingCents)}</strong>
      </footer>
      {model.lowPointDateIso && model.lowPointCents < 0
        ? <p className="mobile-financial-signal" data-tone="warning">
            Lowest point {money(model.lowPointCents)} on {new Intl.DateTimeFormat(state.settings.locale, { weekday: 'long', day: 'numeric', month: 'short' }).format(fromIsoDate(model.lowPointDateIso))}
          </p>
        : <p className="mobile-financial-signal">
            {model.runwayIsInfinite ? 'Income covers everything planned' : `${model.runwayDays} days of runway at this rate`}
          </p>}
    </article>

    <div className="mobile-dashboard-actions" aria-label="Quick actions">
      <button onClick={onAddIncome}><Plus size={18} /> Add income</button>
      <button onClick={onAddBill}><Plus size={18} /> Add bill</button>
    </div>
  </section>
}
