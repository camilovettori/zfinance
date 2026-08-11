# Mobile Dashboard Model Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `src/app/dashboard/mobile-dashboard-model.ts` around the three-act narrative (where I stand / what comes next / where I'm heading), with zero changes to `MobileDashboard.tsx` or any other component.

**Architecture:** `buildMobileDashboardModel(state, referenceDate)` keeps its name and is extended in place across three tasks: Act 2 (horizon) first since it has the most subtle logic (empty days, running balance, low point), then Act 1 (safe-to-spend, runway), then Act 3 (goals, headline/tone). Pure function, no React.

**Tech Stack:** TypeScript, `date-fns`, Vitest, `@testing-library/react` (only for the one existing component-render test, untouched).

## Global Constraints

- Money is integer cents; dates are `'YYYY-MM-DD'` strings.
- `safeToSpendCents` is never clamped to zero — a negative value is real information.
- The `headline` is never pre-formatted with a currency symbol: it returns `{ template: string; values: Record<string, number | string> }` so the component (Phase 3) controls money formatting and privacy masking. No `€`/`$` character may appear in a `template` or in any string `values` entry that represents money.
- `horizon` must include days with zero items — they are what makes the timeline read as a passage of time, not just a filtered event list.
- **Deviation from the source design spec, decided in this plan:** the spec said Phase 2 changes only the model file and Phase 3 changes only the component. But the model's return type is changing shape, and `MobileDashboard.tsx` (Phase 3's job) directly reads the old fields (`tomorrowItems`, `afterTomorrowCents`, `insight`, etc.) — removing them now would fail `pnpm typecheck` before Phase 3 exists to fix it. **Resolution: this phase's `MobileDashboardModel` is a strict superset — all current fields are kept, computed exactly as before, alongside the new Act 1/2/3 fields.** `MobileDashboard.tsx` is not touched at all (0 lines changed) and keeps compiling. Phase 3 deletes the old fields when it rewrites the component. This is flagged to the user in the final report, not a silent scope change.
- Design spec: `docs/superpowers/specs/2026-08-11-mobile-redesign-debt-payoff-design.md`, Phase 2.

---

### Task 1: Types, Act 2 horizon builder, and debt/net-worth wiring

**Files:**
- Modify: `src/app/dashboard/mobile-dashboard-model.ts`
- Create: `src/tests/mobile-dashboard-model.test.ts`

**Interfaces:**
- Consumes: `buildDebtSummary`, `DebtSummary` from `@/domain/debt` (Phase 1, already exists). `buildVisibleItems`, `SimpleItem` from `@/domain/home`. `currentSpendableBalance` from `@/domain/cashflow` (already imported). `todayIso`... no — this file uses `fromIsoDate`/`toIsoDate` already imported from `@/lib/date`; add `differenceInCalendarDays`, `getDaysInMonth` from `date-fns` (already imports `addDays`, `differenceInCalendarDays`, `endOfMonth`, `startOfMonth` — add `getDaysInMonth` to that import).
- Produces (for Task 2 and 3): `export type MoneyEvent = { date: string; dayLabel: string; isToday: boolean; items: SimpleItem[]; incomeCents: number; billsCents: number; netCents: number; balanceAfterCents: number; isLowPoint: boolean; isNegative: boolean }`. On `MobileDashboardModel`, this task adds: `totalOwedCents: number`, `netWorthCents: number`, `debt: DebtSummary`, `horizon: MoneyEvent[]`, `lowPointCents: number`, `lowPointDateIso: string | null`. It also adds temporary stub fields required by the full type (filled for real in Task 2 and 3): `safeToSpendCents: 0`, `safeToSpendUntilIso: todayIso`, `safeToSpendUntilLabel: ''`, `runwayDays: 0`, `runwayIsInfinite: false`, `goals: []`, `headline: { template: '', values: {} }`, `tone: 'good'`. All existing fields (`todayIso`, `tomorrowIso`, `tomorrowLabel`, `availableNowCents`, `afterTomorrowCents`, `tomorrowItems`, `tomorrowIncomingCents`, `tomorrowDueCents`, `nextIncome`, `currentWeek`, `insight`) are unchanged.

**Horizon rule (pinned, implement exactly this):**
1. The horizon window runs from today to `safeToSpendUntilIso` inclusive. Since `safeToSpendUntilIso` isn't computed for real until Task 2, this task computes it locally the same way Task 2 will (so the horizon is correct now and Task 2 doesn't have to touch this code): `safeToSpendUntilIso = nextIncome?.date ?? toIsoDate(addDays(localToday, 7))` (reusing the already-computed `nextIncome`).
2. Walk day by day from `today` to `safeToSpendUntilIso`, **capped at 14 entries** even if the window is longer.
3. Items for the whole window: `buildVisibleItems(state, today, safeToSpendUntilIso, referenceDate).filter((item) => item.status !== 'completed')` — completed items are already reflected in the opening balance.
4. Each day's `balanceAfterCents` is the running balance **after** that day's net flow is applied, starting from `availableNowCents` before day 0 (today) — i.e. today's own items are included in today's `balanceAfterCents`. This matches the existing `buildRollingBalanceProjection` day semantics in `cashflow.ts`.
5. `dayLabel`: `'Today'` for the first entry, `'Tomorrow'` for the second entry when its date is `today + 1`, otherwise `Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(date)`.
6. After building all entries, find the entry with the **lowest** `balanceAfterCents` (first one wins on a tie) and set its `isLowPoint` to `true`; `lowPointCents`/`lowPointDateIso` come from that entry. Every entry gets `isNegative = balanceAfterCents < 0`.

- [ ] **Step 1: Write the failing tests**

Create `src/tests/mobile-dashboard-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildMobileDashboardModel } from '@/app/dashboard/mobile-dashboard-model'
import { createBlankState } from '@/domain/seed'
import type { AppState, FinancialAccount, Transaction } from '@/domain/model'

const referenceDate = new Date(2026, 7, 11, 12, 0, 0) // Tue 11 Aug 2026

function account(overrides: Partial<FinancialAccount>, householdId: string): FinancialAccount {
  return {
    id: crypto.randomUUID(),
    householdId,
    name: 'Current account',
    institution: '',
    type: 'current',
    currency: 'EUR',
    openingBalanceCents: 0,
    currentBalanceCents: 0,
    holder: '',
    accentColor: '#2F7D5B',
    archived: false,
    notes: '',
    ...overrides,
  }
}

function state(balanceCents: number): AppState {
  const state = createBlankState()
  state.settings.currency = 'EUR'
  state.settings.locale = 'en-IE'
  state.settings.weekStartDay = 4
  state.household.currency = 'EUR'
  state.household.locale = 'en-IE'
  state.household.weekStartDay = 4
  state.accounts = [account({ currentBalanceCents: balanceCents, openingBalanceCents: balanceCents }, state.household.id)]
  return state
}

function categoryIds(appState: AppState) {
  const income = appState.categories.find((category) => ['Income', 'Receitas'].includes(category.group))!
  const bill = appState.categories.find((category) => !['Income', 'Receitas', 'Transfers', 'Movimento'].includes(category.group))!
  return { income: income.id, bill: bill.id }
}

function transaction(appState: AppState, values: Partial<Transaction> & Pick<Transaction, 'id' | 'title' | 'amountCents' | 'type' | 'categoryId' | 'transactionDate'>): Transaction {
  return {
    householdId: appState.household.id,
    description: values.title,
    accountId: appState.accounts[0].id,
    dueDate: values.transactionDate,
    status: 'planned',
    tags: [],
    notes: '',
    source: 'manual',
    splits: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...values,
  }
}

describe('buildMobileDashboardModel — horizon (Act 2)', () => {
  it('includes an empty day between two event days', () => {
    const appState = state(100_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'today-bill', title: 'Netflix', amountCents: 2_200, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-11' }),
      transaction(appState, { id: 'later-income', title: 'Wages', amountCents: 50_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-13' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.horizon.map((day) => day.date)).toEqual(['2026-08-11', '2026-08-12', '2026-08-13'])
    expect(model.horizon[1].items).toEqual([])
    expect(model.horizon[1].incomeCents).toBe(0)
    expect(model.horizon[1].billsCents).toBe(0)
    expect(model.horizon[1].dayLabel).toBe('Tomorrow')
  })

  it('carries a running balance across days, applying each day in order', () => {
    const appState = state(100_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'bill', title: 'Rent', amountCents: 40_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-12' }),
      transaction(appState, { id: 'income', title: 'Wages', amountCents: 57_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-13' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.horizon[0].balanceAfterCents).toBe(100_000)
    expect(model.horizon[1].balanceAfterCents).toBe(60_000)
    expect(model.horizon[2].balanceAfterCents).toBe(117_000)
  })

  it('flags the lowest-balance day as the low point and any negative day as negative', () => {
    const appState = state(50_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'bill', title: 'Rent', amountCents: 70_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-12' }),
      transaction(appState, { id: 'income', title: 'Wages', amountCents: 90_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-13' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.horizon[1].balanceAfterCents).toBe(-20_000)
    expect(model.horizon[1].isNegative).toBe(true)
    expect(model.horizon[1].isLowPoint).toBe(true)
    expect(model.lowPointCents).toBe(-20_000)
    expect(model.lowPointDateIso).toBe('2026-08-12')
    expect(model.horizon[0].isLowPoint).toBe(false)
    expect(model.horizon[2].isLowPoint).toBe(false)
  })

  it('caps the horizon at 14 entries when the window is longer', () => {
    const appState = state(100_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'income', title: 'Wages', amountCents: 50_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-31' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.horizon).toHaveLength(14)
    expect(model.horizon[0].date).toBe('2026-08-11')
  })
})

describe('buildMobileDashboardModel — debt and net worth wiring', () => {
  it('surfaces totalOwedCents, netWorthCents and the full debt summary', () => {
    const appState = state(150_000)
    appState.accounts.push(account({ type: 'credit-card', currentBalanceCents: -40_000 }, appState.household.id))

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.totalOwedCents).toBe(40_000)
    expect(model.netWorthCents).toBe(110_000)
    expect(model.debt.accounts).toHaveLength(1)
    expect(model.debt.totalOwedCents).toBe(40_000)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/tests/mobile-dashboard-model.test.ts`
Expected: FAIL — `model.horizon` is `undefined` (doesn't exist on the current model shape).

- [ ] **Step 3: Implement the new type and horizon builder**

In `src/app/dashboard/mobile-dashboard-model.ts`, update the top imports (leave out `getDaysInMonth` for now — `noUnusedLocals` is on in `tsconfig.json` and it isn't used until Task 2, which adds it there):

```ts
import { addDays, differenceInCalendarDays, endOfMonth, startOfMonth } from 'date-fns'
import { buildRollingBalanceProjection, currentSpendableBalance } from '@/domain/cashflow'
import { buildDebtSummary, type DebtSummary } from '@/domain/debt'
import { buildVisibleItems, type SimpleItem } from '@/domain/home'
import type { AppState } from '@/domain/model'
import { buildPlanningWeeks, createPlannerCycle, savingsContributedInRange, type PlanningWeek } from '@/domain/planning'
import { fromIsoDate, toIsoDate } from '@/lib/date'
```

Add the new type above `MobileDashboardModel` and extend `MobileDashboardModel` itself:

```ts
export type MoneyEvent = {
  date: string
  dayLabel: string
  isToday: boolean
  items: SimpleItem[]
  incomeCents: number
  billsCents: number
  netCents: number
  balanceAfterCents: number
  isLowPoint: boolean
  isNegative: boolean
}

export type MobileDashboardModel = {
  // existing fields, unchanged — MobileDashboard.tsx still reads these
  todayIso: string
  tomorrowIso: string
  tomorrowLabel: string
  availableNowCents: number
  afterTomorrowCents: number
  tomorrowItems: SimpleItem[]
  tomorrowIncomingCents: number
  tomorrowDueCents: number
  nextIncome: {
    date: string
    label: string
    daysAway: number
    items: SimpleItem[]
    totalCents: number
  } | null
  currentWeek: PlanningWeek
  insight: 'nothing-tomorrow' | 'tomorrow-covered' | 'week-left' | 'week-short'

  // Act 1 — where I stand
  totalOwedCents: number
  netWorthCents: number
  safeToSpendCents: number
  safeToSpendUntilIso: string
  safeToSpendUntilLabel: string
  runwayDays: number
  runwayIsInfinite: boolean

  // Act 2 — what comes next
  horizon: MoneyEvent[]
  lowPointCents: number
  lowPointDateIso: string | null

  // Act 3 — where I'm heading
  debt: DebtSummary
  goals: Array<{
    id: string
    name: string
    currentCents: number
    targetCents: number
    percent: number
    targetDate?: string
    monthsToTarget: number | null
  }>

  // narrative
  headline: { template: string; values: Record<string, number | string> }
  tone: 'good' | 'tight' | 'warning'
}
```

Add a horizon-building helper just above `buildMobileDashboardModel`:

```ts
function buildHorizon(state: AppState, todayIso: string, horizonEndIso: string, availableNowCents: number, referenceDate: Date): MoneyEvent[] {
  const items = buildVisibleItems(state, todayIso, horizonEndIso, referenceDate).filter((item) => item.status !== 'completed')
  const start = fromIsoDate(todayIso)
  const end = fromIsoDate(horizonEndIso)
  const dayCount = Math.min(14, differenceInCalendarDays(end, start) + 1)
  const tomorrowIso = toIsoDate(addDays(start, 1))

  let runningBalance = availableNowCents
  const days: MoneyEvent[] = []
  for (let index = 0; index < dayCount; index += 1) {
    const date = addDays(start, index)
    const dateIso = toIsoDate(date)
    const dayItems = items.filter((item) => item.date === dateIso)
    const incomeCents = sum(dayItems.filter((item) => item.kind === 'income').map((item) => item.amountCents))
    const billsCents = sum(dayItems.filter((item) => item.kind === 'bill').map((item) => item.amountCents))
    const netCents = incomeCents - billsCents
    runningBalance += netCents
    const dayLabel = dateIso === todayIso ? 'Today' : dateIso === tomorrowIso ? 'Tomorrow'
      : new Intl.DateTimeFormat(state.settings.locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(date)

    days.push({
      date: dateIso,
      dayLabel,
      isToday: dateIso === todayIso,
      items: dayItems,
      incomeCents,
      billsCents,
      netCents,
      balanceAfterCents: runningBalance,
      isLowPoint: false,
      isNegative: runningBalance < 0,
    })
  }

  let lowIndex = 0
  for (let index = 1; index < days.length; index += 1) {
    if (days[index].balanceAfterCents < days[lowIndex].balanceAfterCents) lowIndex = index
  }
  if (days[lowIndex]) days[lowIndex] = { ...days[lowIndex], isLowPoint: true }

  return days
}
```

- [ ] **Step 4: Wire the new fields into `buildMobileDashboardModel`**

Inside `buildMobileDashboardModel`, after the existing `nextIncome` block and before the `return`, add:

```ts
  const debt = buildDebtSummary(state, referenceDate)
  const safeToSpendUntilIso = nextIncome?.date ?? toIsoDate(addDays(localToday, 7))
  const horizon = buildHorizon(state, today, safeToSpendUntilIso, availableNowCents, referenceDate)
  const lowPointEntry = horizon.find((day) => day.isLowPoint) ?? horizon[0]
```

Then extend the `return` statement (keep every existing field, add these):

```ts
  return {
    todayIso: today,
    tomorrowIso: tomorrow,
    tomorrowLabel: new Intl.DateTimeFormat(state.settings.locale, { weekday: 'long', day: 'numeric', month: 'short' }).format(tomorrowDate),
    availableNowCents,
    afterTomorrowCents: availableNowCents + tomorrowIncomingCents - tomorrowDueCents,
    tomorrowItems,
    tomorrowIncomingCents,
    tomorrowDueCents,
    nextIncome,
    currentWeek,
    insight,
    totalOwedCents: debt.totalOwedCents,
    netWorthCents: availableNowCents - debt.totalOwedCents,
    safeToSpendCents: 0,
    safeToSpendUntilIso,
    safeToSpendUntilLabel: '',
    runwayDays: 0,
    runwayIsInfinite: false,
    horizon,
    lowPointCents: lowPointEntry?.balanceAfterCents ?? 0,
    lowPointDateIso: lowPointEntry?.date ?? null,
    debt,
    goals: [],
    headline: { template: '', values: {} },
    tone: 'good',
  }
```

Note: `netWorthCents` is computed inline (`availableNowCents - debt.totalOwedCents`) rather than by calling the `netWorthCents` function from `@/domain/debt` — that function calls `buildDebtSummary(state)` again with its own default `referenceDate`, which could disagree with the `referenceDate` this model was built for. Computing it from the already-built `debt` value keeps a single, consistent reference date. Do not import `netWorthCents` from `@/domain/debt` in this file.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/tests/mobile-dashboard-model.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Run the full existing test suite to confirm no regression**

Run: `pnpm vitest run src/tests/mobile-dashboard.test.tsx`
Expected: PASS (6 tests, unchanged) — this is the regression check that keeping the old fields as a superset actually kept `MobileDashboard.tsx` and its tests working untouched.

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard/mobile-dashboard-model.ts src/tests/mobile-dashboard-model.test.ts
git commit -m "Add Act 2 horizon and debt wiring to mobile dashboard model"
```

---

### Task 2: Act 1 — safe-to-spend and runway

**Files:**
- Modify: `src/app/dashboard/mobile-dashboard-model.ts`
- Test: `src/tests/mobile-dashboard-model.test.ts`

**Interfaces:**
- Consumes: `buildRollingBalanceProjection` from `@/domain/cashflow` (already imported in Task 1), `horizon`/`safeToSpendUntilIso`/`debt` local variables from Task 1's wiring (same function body).
- Produces: real values for `safeToSpendCents`, `safeToSpendUntilLabel`, `runwayDays`, `runwayIsInfinite` (replacing the Task 1 stubs). No new exports.

**Rules (pinned):**
1. `safeToSpendUntilLabel`: if `safeToSpendUntilIso` is within 7 calendar days of today, `"until {weekday}"` (long weekday name); otherwise `"until next {weekday}"`.
2. Horizon bills: `horizonBillsCents` = sum of `billsCents` across the already-built `horizon` array (Task 1) — this is exactly "non-completed bills with date between today and `safeToSpendUntilIso`," since that's what `buildHorizon` already filtered. Reuse it; don't requery.
3. Savings allocation: `monthlyGoalContributionsCents` = sum of `monthlyContributionCents` for `state.goals` where `!goal.archived`. `horizonDays` = `differenceInCalendarDays(fromIsoDate(safeToSpendUntilIso), localToday) + 1`. `savingsAllocationCents = Math.round(monthlyGoalContributionsCents * horizonDays / getDaysInMonth(referenceDate))`.
4. `safeToSpendCents = availableNowCents - horizonBillsCents - savingsAllocationCents`. Never clamp.
5. Runway: `buildRollingBalanceProjection(state, today, toIsoDate(addDays(localToday, 89)), referenceDate)` (90 days total, today inclusive). `runwayDays` = index of the first `day` in `.days` where `closingBalanceCents < 0`; if none, `runwayIsInfinite = true` and `runwayDays = 90`.

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/mobile-dashboard-model.test.ts`:

```ts
describe('buildMobileDashboardModel — safe to spend and runway (Act 1)', () => {
  it('computes safe-to-spend as balance minus horizon bills minus prorated savings, never clamped', () => {
    const appState = state(100_000)
    const category = categoryIds(appState)
    appState.goals = [{
      id: 'goal', householdId: appState.household.id, name: 'Holiday', targetCents: 500_000, currentCents: 0,
      monthlyContributionCents: 31_000, priority: 1, notes: '', archived: false,
    }]
    appState.transactions = [
      transaction(appState, { id: 'income', title: 'Wages', amountCents: 50_000, type: 'income', categoryId: category.income, transactionDate: '2026-08-13' }),
      transaction(appState, { id: 'bill', title: 'Rent', amountCents: 70_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-12' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    // horizon: today 2026-08-11 -> next income 2026-08-13, 3 days. Bills in horizon: 70_000.
    // savings: 31_000 * 3 / 31 (August has 31 days) = 3000 rounded.
    expect(model.safeToSpendCents).toBe(100_000 - 70_000 - 3_000)
  })

  it('does not clamp a negative safe-to-spend value', () => {
    const appState = state(10_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'bill', title: 'Rent', amountCents: 40_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-12' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.safeToSpendCents).toBeLessThan(0)
  })

  it('reports runwayDays as the first day a 90-day projection goes negative', () => {
    const appState = state(10_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'bill', title: 'Rent', amountCents: 40_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-14' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.runwayIsInfinite).toBe(false)
    expect(model.runwayDays).toBe(3) // 08-11=0, 08-12=1, 08-13=2, 08-14=3 -> first negative day index 3
  })

  it('reports runwayIsInfinite when the balance never goes negative in 90 days', () => {
    const model = buildMobileDashboardModel(state(500_000), referenceDate)

    expect(model.runwayIsInfinite).toBe(true)
    expect(model.runwayDays).toBe(90)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/tests/mobile-dashboard-model.test.ts`
Expected: FAIL — `safeToSpendCents` is `0` and `runwayDays` is `0`/`runwayIsInfinite` is `false` from the Task 1 stubs, so all four new assertions fail.

- [ ] **Step 3: Implement Act 1**

Add `getDaysInMonth` to the `date-fns` import at the top of the file (it's needed by the savings-allocation calculation below): `import { addDays, differenceInCalendarDays, endOfMonth, getDaysInMonth, startOfMonth } from 'date-fns'`.

Replace the Task 1 stub block (from Step 4 of Task 1) inside `buildMobileDashboardModel` with:

```ts
  const debt = buildDebtSummary(state, referenceDate)
  const safeToSpendUntilIso = nextIncome?.date ?? toIsoDate(addDays(localToday, 7))
  const horizon = buildHorizon(state, today, safeToSpendUntilIso, availableNowCents, referenceDate)
  const lowPointEntry = horizon.find((day) => day.isLowPoint) ?? horizon[0]

  const safeToSpendUntilDate = fromIsoDate(safeToSpendUntilIso)
  const untilWithinWeek = differenceInCalendarDays(safeToSpendUntilDate, localToday) <= 7
  const untilWeekday = new Intl.DateTimeFormat(state.settings.locale, { weekday: 'long' }).format(safeToSpendUntilDate)
  const safeToSpendUntilLabel = untilWithinWeek ? `until ${untilWeekday}` : `until next ${untilWeekday}`

  const horizonBillsCents = sum(horizon.map((day) => day.billsCents))
  const monthlyGoalContributionsCents = sum(state.goals.filter((goal) => !goal.archived).map((goal) => goal.monthlyContributionCents))
  const horizonDays = differenceInCalendarDays(safeToSpendUntilDate, localToday) + 1
  const savingsAllocationCents = Math.round(monthlyGoalContributionsCents * horizonDays / getDaysInMonth(referenceDate))
  const safeToSpendCents = availableNowCents - horizonBillsCents - savingsAllocationCents

  const runwayWindow = buildRollingBalanceProjection(state, today, toIsoDate(addDays(localToday, 89)), referenceDate)
  const firstNegativeIndex = runwayWindow.days.findIndex((day) => day.closingBalanceCents < 0)
  const runwayIsInfinite = firstNegativeIndex === -1
  const runwayDays = runwayIsInfinite ? 90 : firstNegativeIndex
```

Then update the `return` statement, replacing the five stub lines:

```ts
    safeToSpendCents,
    safeToSpendUntilIso,
    safeToSpendUntilLabel,
    runwayDays,
    runwayIsInfinite,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/tests/mobile-dashboard-model.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/mobile-dashboard-model.ts src/tests/mobile-dashboard-model.test.ts
git commit -m "Add safe-to-spend and runway projection to mobile dashboard model"
```

---

### Task 3: Act 3 — goals and headline/tone

**Files:**
- Modify: `src/app/dashboard/mobile-dashboard-model.ts`
- Test: `src/tests/mobile-dashboard-model.test.ts`

**Interfaces:**
- Consumes: `debt`, `horizon`, `horizonBillsCents`, `safeToSpendCents`, `safeToSpendUntilLabel` local variables from Task 1/2 (same function body).
- Produces: real values for `goals` and `headline`/`tone` (replacing the Task 1 stubs). No new exports.

**Rules (pinned — first matching rule wins):**
1. A `horizon` day has `isNegative === true` → `tone: 'warning'`, template `"Short by {shortfall} on {day} — {billsAmount} of bills before your next payday."`, values `{ shortfall: <absolute value of that day's balanceAfterCents, cents>, day: <that day's full weekday name>, billsAmount: horizonBillsCents }`. Use the **first** negative day found.
2. Else if `availableNowCents > 0 && safeToSpendCents < availableNowCents * 0.1` → `tone: 'tight'`, template `"{safeToSpend} to spend {until}. It's tight but it holds."`, values `{ safeToSpend: safeToSpendCents, until: safeToSpendUntilLabel }`.
3. Else if `!debt.isDebtFree && debt.payoffDateIso !== null` → `tone: 'good'`, template `"{safeToSpend} to spend {until}. Debt-free by {payoffDate} at this pace."`, values `{ safeToSpend: safeToSpendCents, until: safeToSpendUntilLabel, payoffDate: <"Month YYYY" from debt.payoffDateIso> }`.
4. Else if any goal's `percent > 75` → `tone: 'good'`, template `"{safeToSpend} to spend {until}. {goalName} is {percent}% there."`, values `{ safeToSpend: safeToSpendCents, until: safeToSpendUntilLabel, goalName: <first such goal's name>, percent: <that goal's percent> }`.
5. Else → `tone: 'good'`, template `"{safeToSpend} to spend {until}."`, values `{ safeToSpend: safeToSpendCents, until: safeToSpendUntilLabel }`.

**Goal mapping:** for each `state.goals` where `!goal.archived`: `percent = goal.targetCents > 0 ? Math.min(100, Math.round(goal.currentCents / goal.targetCents * 100)) : 100`. `monthsToTarget = goal.monthlyContributionCents > 0 ? Math.ceil((goal.targetCents - goal.currentCents) / goal.monthlyContributionCents) : null`.

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/mobile-dashboard-model.test.ts`:

```ts
describe('buildMobileDashboardModel — goals and headline (Act 3)', () => {
  it('maps goals with percent and monthsToTarget', () => {
    const appState = state(100_000)
    appState.goals = [{
      id: 'goal', householdId: appState.household.id, name: 'Holiday', targetCents: 250_000, currentCents: 68_000,
      monthlyContributionCents: 20_000, priority: 1, notes: '', archived: false, targetDate: '2026-12-01',
    }]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.goals).toHaveLength(1)
    expect(model.goals[0]).toMatchObject({ name: 'Holiday', currentCents: 68_000, targetCents: 250_000, percent: 27, monthsToTarget: 10 })
  })

  it('produces a warning headline with structured values (never pre-formatted money) when a horizon day goes negative', () => {
    const appState = state(50_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'bill', title: 'Rent', amountCents: 70_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-13' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.tone).toBe('warning')
    expect(model.headline.template).toBe('Short by {shortfall} on {day} — {billsAmount} of bills before your next payday.')
    expect(model.headline.values.shortfall).toBe(20_000)
    expect(model.headline.values.day).toBe('Thursday')
    expect(model.headline.values.billsAmount).toBe(70_000)
    expect(model.headline.template).not.toMatch(/[€$]/)
    for (const value of Object.values(model.headline.values)) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true)
      else expect(value).not.toMatch(/[€$]/)
    }
  })

  it('produces a tight headline when safe-to-spend is under 10% of the available balance', () => {
    const appState = state(100_000)
    const category = categoryIds(appState)
    appState.transactions = [
      transaction(appState, { id: 'bill', title: 'Rent', amountCents: 92_000, type: 'expense', categoryId: category.bill, transactionDate: '2026-08-15' }),
    ]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.tone).toBe('tight')
    expect(model.headline.template).toBe("{safeToSpend} to spend {until}. It's tight but it holds.")
  })

  it('produces a good/debt headline with a payoff date when debt exists and a pace is known', () => {
    const appState = state(200_000)
    const category = categoryIds(appState)
    const card = account({ type: 'credit-card', currentBalanceCents: -30_000 }, appState.household.id)
    appState.accounts.push(card)
    appState.recurringRules = [{
      id: 'card-payment', householdId: appState.household.id, name: 'Card payment', amountCents: 5_000, frequency: 'monthly',
      interval: 1, nextDueDate: '2026-09-01', accountId: card.id, categoryId: category.bill, generateAutomatically: true, reminder: false, active: true,
    }]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.tone).toBe('good')
    expect(model.headline.template).toBe('{safeToSpend} to spend {until}. Debt-free by {payoffDate} at this pace.')
    // totalOwedCents 30_000 / pace 5_000 = 6 months from referenceDate (11 Aug 2026) -> 11 Feb 2027.
    expect(model.headline.values.payoffDate).toBe('February 2027')
  })

  it('produces a good/goal headline when a goal is over 75% funded and there is no debt or shortfall', () => {
    const appState = state(100_000)
    appState.goals = [{
      id: 'goal', householdId: appState.household.id, name: 'Emergency fund', targetCents: 100_000, currentCents: 80_000,
      monthlyContributionCents: 10_000, priority: 1, notes: '', archived: false,
    }]

    const model = buildMobileDashboardModel(appState, referenceDate)

    expect(model.tone).toBe('good')
    expect(model.headline.template).toBe('{safeToSpend} to spend {until}. {goalName} is {percent}% there.')
    expect(model.headline.values.goalName).toBe('Emergency fund')
    expect(model.headline.values.percent).toBe(80)
  })

  it('falls back to the plain safe-to-spend headline with no debt or goals', () => {
    const model = buildMobileDashboardModel(state(200_000), referenceDate)

    expect(model.tone).toBe('good')
    expect(model.headline.template).toBe('{safeToSpend} to spend {until}.')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/tests/mobile-dashboard-model.test.ts`
Expected: FAIL — `goals` is `[]` and `headline`/`tone` are the Task 1 stubs, so all six new tests fail.

- [ ] **Step 3: Implement Act 3**

Inside `buildMobileDashboardModel`, after the Act 1 block from Task 2 and before the `return`, add:

```ts
  const goals = state.goals.filter((goal) => !goal.archived).map((goal) => ({
    id: goal.id,
    name: goal.name,
    currentCents: goal.currentCents,
    targetCents: goal.targetCents,
    percent: goal.targetCents > 0 ? Math.min(100, Math.round((goal.currentCents / goal.targetCents) * 100)) : 100,
    targetDate: goal.targetDate,
    monthsToTarget: goal.monthlyContributionCents > 0 ? Math.ceil((goal.targetCents - goal.currentCents) / goal.monthlyContributionCents) : null,
  }))

  const firstNegativeDay = horizon.find((day) => day.isNegative)
  const tightMargin = availableNowCents > 0 && safeToSpendCents < availableNowCents * 0.1
  const debtGoalWithProgress = goals.find((goal) => goal.percent > 75)

  const { headline, tone } = firstNegativeDay
    ? {
      tone: 'warning' as const,
      headline: {
        template: 'Short by {shortfall} on {day} — {billsAmount} of bills before your next payday.',
        values: {
          shortfall: Math.abs(firstNegativeDay.balanceAfterCents),
          day: new Intl.DateTimeFormat(state.settings.locale, { weekday: 'long' }).format(fromIsoDate(firstNegativeDay.date)),
          billsAmount: horizonBillsCents,
        },
      },
    }
    : tightMargin
      ? {
        tone: 'tight' as const,
        headline: {
          template: "{safeToSpend} to spend {until}. It's tight but it holds.",
          values: { safeToSpend: safeToSpendCents, until: safeToSpendUntilLabel },
        },
      }
      : !debt.isDebtFree && debt.payoffDateIso
        ? {
          tone: 'good' as const,
          headline: {
            template: '{safeToSpend} to spend {until}. Debt-free by {payoffDate} at this pace.',
            values: {
              safeToSpend: safeToSpendCents,
              until: safeToSpendUntilLabel,
              payoffDate: new Intl.DateTimeFormat(state.settings.locale, { month: 'long', year: 'numeric' }).format(fromIsoDate(debt.payoffDateIso)),
            },
          },
        }
        : debtGoalWithProgress
          ? {
            tone: 'good' as const,
            headline: {
              template: '{safeToSpend} to spend {until}. {goalName} is {percent}% there.',
              values: { safeToSpend: safeToSpendCents, until: safeToSpendUntilLabel, goalName: debtGoalWithProgress.name, percent: debtGoalWithProgress.percent },
            },
          }
          : {
            tone: 'good' as const,
            headline: {
              template: '{safeToSpend} to spend {until}.',
              values: { safeToSpend: safeToSpendCents, until: safeToSpendUntilLabel },
            },
          }
```

Then update the `return` statement, replacing the three stub lines:

```ts
    goals,
    headline,
    tone,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/tests/mobile-dashboard-model.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/mobile-dashboard-model.ts src/tests/mobile-dashboard-model.test.ts
git commit -m "Add goals and headline/tone narrative to mobile dashboard model"
```

---

### Task 4: Full regression check and verify

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all files pass, including the untouched `src/tests/mobile-dashboard.test.tsx` (proves the superset-field decision kept `MobileDashboard.tsx` compiling and working with zero changes) and the new `src/tests/mobile-dashboard-model.test.ts` (15 tests).

- [ ] **Step 2: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all clean.

- [ ] **Step 3: Confirm MobileDashboard.tsx is untouched**

Run: `git diff --stat main -- src/app/dashboard/MobileDashboard.tsx` (or `git log --oneline -- src/app/dashboard/MobileDashboard.tsx` since the start of this plan) — expect no changes from this plan's commits.

- [ ] **Step 4: Report to the user**

Show the full `MobileDashboardModel` type (as it now stands in the file) and the `headline`/`values` output for the warning-tone test case from Task 3, per the user's explicit request before Phase 3 starts.
