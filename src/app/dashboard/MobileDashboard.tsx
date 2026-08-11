import { ArrowDownLeft, ArrowUpRight, Plus } from 'lucide-react'
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
}

export function MobileDashboard({ state, referenceDate = new Date(), onEditItem, onAddIncome, onAddBill }: Props) {
  const model = buildMobileDashboardModel(state, referenceDate)
  const hidden = state.settings.hideSensitiveValues || state.settings.privacyMode
  const money = (amountCents: number) => formatSimpleCurrency(amountCents, state.settings.locale, state.settings.currency, hidden)
  const signedMoney = (amountCents: number, kind: 'income' | 'bill') => hidden
    ? '••••'
    : `${kind === 'income' ? '+' : '−'}${money(Math.abs(amountCents))}`
  const visibleTomorrowItems = model.tomorrowItems.slice(0, 4)
  const remainingTomorrowItems = model.tomorrowItems.length - visibleTomorrowItems.length
  const nextIncomeDays = model.nextIncome?.daysAway
  const insight = model.insight === 'nothing-tomorrow'
    ? 'Nothing due tomorrow'
    : model.insight === 'tomorrow-covered'
      ? 'Tomorrow’s income covers tomorrow’s bills'
      : model.insight === 'week-left'
        ? `${money(model.currentWeek.closingBalanceCents)} left after this week`
        : `${money(Math.abs(model.currentWeek.closingBalanceCents))} short after this week`

  return <section className="mobile-dashboard" aria-label="Mobile household dashboard">
    <header className="mobile-dashboard-header">
      <div><p>HomeCoin</p><h1>{state.household.name}</h1></div>
      <time dateTime={model.todayIso}>{new Intl.DateTimeFormat(state.settings.locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(fromIsoDate(model.todayIso))}</time>
    </header>

    <article className="mobile-now-card">
      <p>Available now</p>
      <strong className={model.availableNowCents < 0 ? 'money-negative' : ''}>{money(model.availableNowCents)}</strong>
      <div>
        <span>{model.tomorrowItems.length ? 'After tomorrow' : 'Tomorrow'}</span>
        <b className={model.afterTomorrowCents < 0 ? 'money-negative' : ''}>
          {model.tomorrowItems.length ? `${money(model.afterTomorrowCents)} remaining` : 'No payments due tomorrow'}
        </b>
      </div>
    </article>

    <article className="mobile-tomorrow-card">
      <header><div><p>Tomorrow</p><h2>{model.tomorrowLabel}</h2></div><span>{model.tomorrowItems.length}</span></header>
      {visibleTomorrowItems.length ? <div className="mobile-tomorrow-list">
        {visibleTomorrowItems.map((item) => {
          const category = state.categories.find((candidate) => candidate.id === item.categoryId)
          return <button key={item.id} onClick={() => onEditItem(item)}>
            <span className={`mobile-money-icon ${item.kind}`} aria-hidden="true">{item.kind === 'income' ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span>
            <span><strong>{item.title}</strong>{category ? <small>{category.name}</small> : null}</span>
            <b className={item.kind === 'income' ? 'money-positive' : 'money-negative'}>{signedMoney(item.amountCents, item.kind)}</b>
          </button>
        })}
        {remainingTomorrowItems > 0 ? <p className="mobile-more-items">+ {remainingTomorrowItems} more tomorrow</p> : null}
      </div> : <p className="mobile-tomorrow-empty">Nothing due tomorrow</p>}
      <footer>
        <span>Incoming<b className="money-positive">{signedMoney(model.tomorrowIncomingCents, 'income')}</b></span>
        <span>Due<b className="money-negative">{signedMoney(model.tomorrowDueCents, 'bill')}</b></span>
        <span>After day<b className={model.afterTomorrowCents < 0 ? 'money-negative' : ''}>{money(model.afterTomorrowCents)}</b></span>
      </footer>
    </article>

    <article className="mobile-next-income-card">
      <div><p>Next income</p>{model.nextIncome ? <>
        <h2>{model.nextIncome.items.length === 1 ? model.nextIncome.items[0].title : model.nextIncome.label}</h2>
        <span>{model.nextIncome.items.length === 1 ? model.nextIncome.label : `${model.nextIncome.items.length} incomes`}</span>
      </> : <><h2>No upcoming income</h2><span>No income scheduled in the next year</span></>}</div>
      {model.nextIncome ? <div><small>{nextIncomeDays === 0 ? 'today' : nextIncomeDays === 1 ? 'tomorrow' : `in ${nextIncomeDays} days`}</small><strong className="money-positive">{signedMoney(model.nextIncome.totalCents, 'income')}</strong></div> : null}
    </article>

    <article className="mobile-week-card">
      <header><div><p>Current week</p><h2>{model.currentWeek.label}</h2></div></header>
      <div className="mobile-week-opening"><span>Opening balance</span><strong className={model.currentWeek.openingBalanceCents < 0 ? 'money-negative' : ''}>{money(model.currentWeek.openingBalanceCents)}</strong></div>
      <div className="mobile-week-flows">
        <span>Income<strong className="money-positive">{signedMoney(model.currentWeek.incomeCents, 'income')}</strong></span>
        <span>Bills<strong className="money-negative">{signedMoney(model.currentWeek.expenseCents, 'bill')}</strong></span>
      </div>
      <div className="mobile-week-savings"><span>Savings</span><strong>{money(model.currentWeek.plannedSavingsCents)}</strong></div>
      <footer><span>Expected closing</span><strong className={model.currentWeek.closingBalanceCents < 0 ? 'money-negative' : ''}>{money(model.currentWeek.closingBalanceCents)}</strong></footer>
      <p className="mobile-financial-signal">{insight}</p>
    </article>

    <div className="mobile-dashboard-actions" aria-label="Quick actions">
      <button onClick={onAddIncome}><Plus size={18} /> Add income</button>
      <button onClick={onAddBill}><Plus size={18} /> Add bill</button>
    </div>
  </section>
}
