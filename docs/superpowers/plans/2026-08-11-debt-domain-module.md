# Debt Domain Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure domain module (`src/domain/debt.ts`) that computes liability totals, a debt payoff projection, and household net worth from existing `AppState` data, with zero UI changes.

**Architecture:** One new file, `src/domain/debt.ts`, following the existing domain-module pattern (`src/domain/cashflow.ts`, `src/domain/planning.ts`): pure functions taking `AppState` (+ optional `referenceDate`) and returning plain data. It imports `currentSpendableBalance` from `./cashflow` and date helpers from `@/lib/date`. No other file changes.

**Tech Stack:** TypeScript, `date-fns` (`addMonths`, `startOfMonth`, `subMonths`), Vitest.

## Global Constraints

- Money is integer cents everywhere; dates are `'YYYY-MM-DD'` strings (see `src/lib/date.ts`).
- Owed amount per liability account is always `Math.abs(account.currentBalanceCents)` — robust to the balance being entered as either sign.
- Never fabricate a payoff date: `payoffDateIso` is `null` whenever the monthly payment pace is `0`, even if debt is outstanding.
- `src/domain/cashflow.ts` must not change. `spendableAccountIds`/`currentSpendableBalance` behavior is pinned by a regression test.
- Archived accounts are excluded from every debt calculation.
- Design spec: `docs/superpowers/specs/2026-08-11-mobile-redesign-debt-payoff-design.md`, Phase 1.

---

### Task 1: Liability account summary and core `DebtSummary` shape

**Files:**
- Create: `src/domain/debt.ts`
- Test: `src/tests/debt.test.ts`

**Interfaces:**
- Produces (for Task 2 and 3, and for later phases): `LIABILITY_ACCOUNT_TYPES: readonly ['credit-card', 'loan', 'financing']`, `type LiabilityAccountSummary = { accountId: string; name: string; type: AccountType; owedCents: number; accentColor: string }`, `type DebtSummary = { accounts: LiabilityAccountSummary[]; totalOwedCents: number; originalTotalCents: number; paidOffCents: number; paidOffPercent: number; monthlyPaymentPaceCents: number; monthsRemaining: number | null; payoffDateIso: string | null; isDebtFree: boolean }`, `function buildDebtSummary(state: AppState): DebtSummary`.
- This task stubs `monthlyPaymentPaceCents` to `0`, `monthsRemaining`/`payoffDateIso` to `null` — Task 2 fills in the real calculation and changes the signature to `buildDebtSummary(state: AppState, referenceDate = new Date())`. All other fields are final in this task.

- [ ] **Step 1: Write the failing tests**

Create `src/tests/debt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildDebtSummary, LIABILITY_ACCOUNT_TYPES } from '@/domain/debt'
import { createBlankState } from '@/domain/seed'
import type { AppState, FinancialAccount } from '@/domain/model'

function account(overrides: Partial<FinancialAccount>, householdId: string): FinancialAccount {
  return {
    id: crypto.randomUUID(),
    householdId,
    name: 'Account',
    institution: 'Local',
    type: 'current',
    currency: 'EUR',
    openingBalanceCents: 0,
    currentBalanceCents: 0,
    holder: 'Household',
    accentColor: '#000000',
    archived: false,
    notes: '',
    ...overrides,
  }
}

function fixture() {
  const state = createBlankState()
  return { state }
}

describe('buildDebtSummary — liability accounts', () => {
  it('reports the same owed total whether the balance was entered as negative or positive', () => {
    const { state } = fixture()
    const negative = account({ name: 'Visa', type: 'credit-card', currentBalanceCents: -52_300 }, state.household.id)
    const positive = account({ name: 'Revolut', type: 'credit-card', currentBalanceCents: 25_000 }, state.household.id)
    state.accounts = [negative, positive]

    const summary = buildDebtSummary(state)

    expect(summary.accounts).toHaveLength(2)
    expect(summary.accounts.find((entry) => entry.accountId === negative.id)?.owedCents).toBe(52_300)
    expect(summary.accounts.find((entry) => entry.accountId === positive.id)?.owedCents).toBe(25_000)
    expect(summary.totalOwedCents).toBe(77_300)
  })

  it('excludes archived liability accounts', () => {
    const { state } = fixture()
    const active = account({ type: 'loan', currentBalanceCents: -10_000 }, state.household.id)
    const archived = account({ type: 'loan', currentBalanceCents: -5_000, archived: true }, state.household.id)
    state.accounts = [active, archived]

    const summary = buildDebtSummary(state)

    expect(summary.accounts).toHaveLength(1)
    expect(summary.totalOwedCents).toBe(10_000)
  })

  it('only counts the three liability account types', () => {
    expect(LIABILITY_ACCOUNT_TYPES).toEqual(['credit-card', 'loan', 'financing'])
    const { state } = fixture()
    state.accounts = [
      account({ type: 'current', currentBalanceCents: -1_000 }, state.household.id),
      account({ type: 'savings', currentBalanceCents: -2_000 }, state.household.id),
    ]

    const summary = buildDebtSummary(state)

    expect(summary.accounts).toHaveLength(0)
    expect(summary.totalOwedCents).toBe(0)
  })

  it('returns a debt-free summary for a household with no liability accounts', () => {
    const { state } = fixture()
    state.accounts = [account({ type: 'current', currentBalanceCents: 100_000 }, state.household.id)]

    const summary = buildDebtSummary(state)

    expect(summary.totalOwedCents).toBe(0)
    expect(summary.isDebtFree).toBe(true)
    expect(summary.payoffDateIso).toBeNull()
    expect(summary.paidOffPercent).toBe(100)
  })

  it('computes paid-off amount and percent from opening vs current balance', () => {
    const { state } = fixture()
    state.accounts = [
      account({ type: 'credit-card', openingBalanceCents: -100_000, currentBalanceCents: -40_000 }, state.household.id),
    ]

    const summary = buildDebtSummary(state)

    expect(summary.originalTotalCents).toBe(100_000)
    expect(summary.totalOwedCents).toBe(40_000)
    expect(summary.paidOffCents).toBe(60_000)
    expect(summary.paidOffPercent).toBe(60)
  })

  it('floors paid-off percent at 0 when debt has grown past the opening balance', () => {
    const { state } = fixture()
    state.accounts = [
      account({ type: 'credit-card', openingBalanceCents: -10_000, currentBalanceCents: -15_000 }, state.household.id),
    ]

    const summary = buildDebtSummary(state)

    expect(summary.paidOffCents).toBe(0)
    expect(summary.paidOffPercent).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/tests/debt.test.ts`
Expected: FAIL — `Cannot find module '@/domain/debt'` (the file doesn't exist yet).

- [ ] **Step 3: Implement `src/domain/debt.ts`**

```ts
import type { AccountType, AppState } from './model'

export const LIABILITY_ACCOUNT_TYPES = ['credit-card', 'loan', 'financing'] as const

export type LiabilityAccountSummary = {
  accountId: string
  name: string
  type: AccountType
  owedCents: number
  accentColor: string
}

export type DebtSummary = {
  accounts: LiabilityAccountSummary[]
  totalOwedCents: number
  originalTotalCents: number
  paidOffCents: number
  paidOffPercent: number
  monthlyPaymentPaceCents: number
  monthsRemaining: number | null
  payoffDateIso: string | null
  isDebtFree: boolean
}

function liabilityAccounts(state: AppState) {
  return state.accounts.filter(
    (account) => !account.archived && LIABILITY_ACCOUNT_TYPES.includes(account.type as (typeof LIABILITY_ACCOUNT_TYPES)[number]),
  )
}

export function buildDebtSummary(state: AppState): DebtSummary {
  const accounts = liabilityAccounts(state).map((account) => ({
    accountId: account.id,
    name: account.name,
    type: account.type,
    owedCents: Math.abs(account.currentBalanceCents),
    accentColor: account.accentColor,
  }))

  const totalOwedCents = accounts.reduce((total, account) => total + account.owedCents, 0)
  const originalTotalCents = liabilityAccounts(state).reduce((total, account) => total + Math.abs(account.openingBalanceCents), 0)
  const paidOffCents = Math.max(0, originalTotalCents - totalOwedCents)
  const paidOffPercent = originalTotalCents === 0 ? 100 : Math.round((paidOffCents / originalTotalCents) * 100)

  return {
    accounts,
    totalOwedCents,
    originalTotalCents,
    paidOffCents,
    paidOffPercent,
    monthlyPaymentPaceCents: 0,
    monthsRemaining: null,
    payoffDateIso: null,
    isDebtFree: totalOwedCents === 0,
  }
}
```

Note: `buildDebtSummary` does not take a `referenceDate` parameter yet — Task 2 adds it
(`tsconfig.json` has `noUnusedParameters: true`, so an unused parameter would fail
typecheck). The Task 1 interface listed at the top of this task showed the final Task 2
signature for forward reference only; this step's actual code has no `referenceDate`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/tests/debt.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean

- [ ] **Step 6: Commit**

```bash
git add src/domain/debt.ts src/tests/debt.test.ts
git commit -m "Add liability account summary to new debt domain module"
```

---

### Task 2: Monthly payment pace and payoff projection

**Files:**
- Modify: `src/domain/debt.ts`
- Test: `src/tests/debt.test.ts`

**Interfaces:**
- Consumes: `LIABILITY_ACCOUNT_TYPES`, `DebtSummary`, `buildDebtSummary` from Task 1 (same file, extending it in place).
- Produces: `buildDebtSummary` now returns real `monthlyPaymentPaceCents`, `monthsRemaining`, `payoffDateIso` instead of the Task 1 stubs. No new exports.

**Pace rule (pinned by the spec, implement exactly this):**
1. Primary source — completed payments in the last 3 full calendar months (the 3 months strictly before the calendar month of `referenceDate`; if `referenceDate` is 2026-08-11, that's May, June, July 2026): sum `transaction.amountCents` for every transaction where `transaction.status === 'paid'` AND (`transaction.type === 'expense' && transaction.accountId` is a liability account) OR (`transaction.type === 'transfer' && transaction.counterpartyAccountId` is a liability account). Divide the 3-month sum by 3.
2. Fallback, used only when the primary source is exactly `0`: sum active (`rule.active === true`) recurring rules whose `accountId` is a liability account, normalized to a monthly amount: `weekly` × 52/12, `fortnightly` × 26/12, `monthly` × 1, `yearly` ÷ 12. Any other frequency (`bimonthly`, `quarterly`, `semiannual`, `custom`) contributes `0` — out of scope for this pace estimate, matching the source spec which only defines these four factors.
3. If both are `0`, `monthlyPaymentPaceCents` is `0`.
4. `monthsRemaining` = `Math.ceil(totalOwedCents / monthlyPaymentPaceCents)` when `monthlyPaymentPaceCents > 0 && totalOwedCents > 0`, otherwise `null`.
5. `payoffDateIso` = `toIsoDate(addMonths(referenceDate, monthsRemaining))` when `monthsRemaining` is a number, otherwise `null`.

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/debt.test.ts` (add `Transaction`, `RecurringRule` to the model import, add `addMonths`/`subMonths` import from `date-fns` for building fixture dates, and add `toIsoDate` from `@/lib/date`):

```ts
import { addMonths, subMonths } from 'date-fns'
import { toIsoDate } from '@/lib/date'
import type { RecurringRule, Transaction } from '@/domain/model'

function transaction(overrides: Partial<Transaction>, householdId: string, categoryId: string, accountId: string): Transaction {
  return {
    id: crypto.randomUUID(),
    householdId,
    title: 'Payment',
    description: 'Payment',
    amountCents: 0,
    type: 'expense',
    categoryId,
    accountId,
    transactionDate: '2026-01-01',
    status: 'paid',
    tags: [],
    notes: '',
    source: 'manual',
    splits: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function rule(overrides: Partial<RecurringRule>, householdId: string, categoryId: string, accountId: string): RecurringRule {
  return {
    id: crypto.randomUUID(),
    householdId,
    name: 'Card payment',
    amountCents: 0,
    frequency: 'monthly',
    interval: 1,
    nextDueDate: '2026-09-01',
    accountId,
    categoryId,
    generateAutomatically: true,
    reminder: false,
    active: true,
    ...overrides,
  }
}

describe('buildDebtSummary — payoff projection', () => {
  const referenceDate = new Date('2026-08-11T12:00:00')

  it('projects a payoff date from 3 months of completed liability payments', () => {
    const { state } = fixture()
    const card = account({ type: 'credit-card', currentBalanceCents: -60_000 }, state.household.id)
    state.accounts = [card]
    const categoryId = state.categories[0].id
    const months = [subMonths(referenceDate, 1), subMonths(referenceDate, 2), subMonths(referenceDate, 3)]
    state.transactions = months.map((month) =>
      transaction({ amountCents: 10_000, transactionDate: toIsoDate(month), status: 'paid', type: 'expense' }, state.household.id, categoryId, card.id),
    )

    const summary = buildDebtSummary(state, referenceDate)

    expect(summary.monthlyPaymentPaceCents).toBe(10_000)
    expect(summary.monthsRemaining).toBe(6)
    expect(summary.payoffDateIso).toBe(toIsoDate(addMonths(referenceDate, 6)))
  })

  it('counts transfers into a liability account as payments', () => {
    const { state } = fixture()
    const spending = account({ type: 'current', currentBalanceCents: 200_000 }, state.household.id)
    const card = account({ type: 'credit-card', currentBalanceCents: -30_000 }, state.household.id)
    state.accounts = [spending, card]
    const categoryId = state.categories[0].id
    state.transactions = [subMonths(referenceDate, 1), subMonths(referenceDate, 2), subMonths(referenceDate, 3)].map((month) =>
      transaction(
        { amountCents: 5_000, transactionDate: toIsoDate(month), status: 'paid', type: 'transfer', accountId: spending.id, counterpartyAccountId: card.id },
        state.household.id,
        categoryId,
        spending.id,
      ),
    )

    const summary = buildDebtSummary(state, referenceDate)

    expect(summary.monthlyPaymentPaceCents).toBe(5_000)
  })

  it('falls back to recurring rules when there is no payment history', () => {
    const { state } = fixture()
    const card = account({ type: 'credit-card', currentBalanceCents: -24_000 }, state.household.id)
    state.accounts = [card]
    const categoryId = state.categories[0].id
    state.recurringRules = [rule({ amountCents: 2_000, frequency: 'monthly' }, state.household.id, categoryId, card.id)]

    const summary = buildDebtSummary(state, referenceDate)

    expect(summary.monthlyPaymentPaceCents).toBe(2_000)
    expect(summary.monthsRemaining).toBe(12)
  })

  it('never fabricates a payoff date when the pace is zero', () => {
    const { state } = fixture()
    state.accounts = [account({ type: 'credit-card', currentBalanceCents: -24_000 }, state.household.id)]

    const summary = buildDebtSummary(state, referenceDate)

    expect(summary.monthlyPaymentPaceCents).toBe(0)
    expect(summary.monthsRemaining).toBeNull()
    expect(summary.payoffDateIso).toBeNull()
  })

  it('ignores inactive recurring rules in the fallback', () => {
    const { state } = fixture()
    const card = account({ type: 'credit-card', currentBalanceCents: -24_000 }, state.household.id)
    state.accounts = [card]
    const categoryId = state.categories[0].id
    state.recurringRules = [rule({ amountCents: 2_000, frequency: 'monthly', active: false }, state.household.id, categoryId, card.id)]

    const summary = buildDebtSummary(state, referenceDate)

    expect(summary.monthlyPaymentPaceCents).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/tests/debt.test.ts`
Expected: FAIL on the new `describe('buildDebtSummary — payoff projection', ...)` block — `monthlyPaymentPaceCents` is always `0` from the Task 1 stub, so the projection assertions fail.

- [ ] **Step 3: Implement the pace calculation**

At the top of `src/domain/debt.ts`, replace the existing `import type { AccountType, AppState } from './model'` line with these three import lines (don't add a second, separate `./model` import — merge into one):

```ts
import { addMonths, startOfMonth, subMonths } from 'date-fns'
import type { AccountType, AppState, RecurringRule } from './model'
import { toIsoDate } from '@/lib/date'
```

Then add the following new code inside `src/domain/debt.ts`, just above `export function buildDebtSummary`:

```ts
const isLiabilityAccount = (state: AppState, accountId: string) => {
  const account = state.accounts.find((candidate) => candidate.id === accountId)
  return Boolean(account && !account.archived && LIABILITY_ACCOUNT_TYPES.includes(account.type as (typeof LIABILITY_ACCOUNT_TYPES)[number]))
}

const MONTHLY_FACTOR: Partial<Record<RecurringRule['frequency'], number>> = {
  weekly: 52 / 12,
  fortnightly: 26 / 12,
  monthly: 1,
  yearly: 1 / 12,
}

function paymentHistoryPaceCents(state: AppState, referenceDate: Date) {
  const windowEnd = startOfMonth(referenceDate)
  const windowStart = subMonths(windowEnd, 3)
  const windowEndIso = toIsoDate(windowEnd)
  const windowStartIso = toIsoDate(windowStart)
  const total = state.transactions
    .filter((transaction) => transaction.status === 'paid')
    .filter((transaction) => transaction.transactionDate >= windowStartIso && transaction.transactionDate < windowEndIso)
    .filter((transaction) =>
      (transaction.type === 'expense' && isLiabilityAccount(state, transaction.accountId)) ||
      (transaction.type === 'transfer' && isLiabilityAccount(state, transaction.counterpartyAccountId ?? '')),
    )
    .reduce((sum, transaction) => sum + transaction.amountCents, 0)
  return Math.round(total / 3)
}

function recurringRulePaceCents(state: AppState) {
  return state.recurringRules
    .filter((rule) => rule.active && isLiabilityAccount(state, rule.accountId))
    .reduce((sum, rule) => sum + rule.amountCents * (MONTHLY_FACTOR[rule.frequency] ?? 0), 0)
}
```

Then, inside `buildDebtSummary`, replace the stubbed return fields:

```ts
  const historyPace = paymentHistoryPaceCents(state, referenceDate)
  const monthlyPaymentPaceCents = historyPace > 0 ? historyPace : Math.round(recurringRulePaceCents(state))
  const monthsRemaining = monthlyPaymentPaceCents > 0 && totalOwedCents > 0
    ? Math.ceil(totalOwedCents / monthlyPaymentPaceCents)
    : null
  const payoffDateIso = monthsRemaining === null ? null : toIsoDate(addMonths(referenceDate, monthsRemaining))

  return {
    accounts,
    totalOwedCents,
    originalTotalCents,
    paidOffCents,
    paidOffPercent,
    monthlyPaymentPaceCents,
    monthsRemaining,
    payoffDateIso,
    isDebtFree: totalOwedCents === 0,
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/tests/debt.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean

- [ ] **Step 6: Commit**

```bash
git add src/domain/debt.ts src/tests/debt.test.ts
git commit -m "Add payoff pace and projection to debt domain module"
```

---

### Task 3: Net worth and cashflow regression guard

**Files:**
- Modify: `src/domain/debt.ts`
- Test: `src/tests/debt.test.ts`

**Interfaces:**
- Consumes: `currentSpendableBalance` from `src/domain/cashflow.ts` (`export const currentSpendableBalance = (state: AppState) => number`, already exists, unchanged), `buildDebtSummary` from Task 2.
- Produces: `export function netWorthCents(state: AppState): number`.

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/debt.test.ts`:

```ts
import { netWorthCents } from '@/domain/debt'

describe('netWorthCents', () => {
  it('subtracts total owed from the spendable balance', () => {
    const { state } = fixture()
    state.accounts = [
      account({ type: 'current', currentBalanceCents: 150_000 }, state.household.id),
      account({ type: 'credit-card', currentBalanceCents: -40_000 }, state.household.id),
    ]

    expect(netWorthCents(state)).toBe(110_000)
  })

  it('does not let liability accounts affect currentSpendableBalance (cashflow.ts regression)', () => {
    const { state } = fixture()
    state.accounts = [
      account({ type: 'current', currentBalanceCents: 150_000 }, state.household.id),
      account({ type: 'credit-card', currentBalanceCents: -40_000 }, state.household.id),
      account({ type: 'loan', currentBalanceCents: -80_000 }, state.household.id),
    ]

    // currentSpendableBalance must ignore credit-card/loan/financing entirely — pinned
    // against a regression in cashflow.ts's spendableAccountIds filter.
    expect(currentSpendableBalance(state)).toBe(150_000)
  })
})
```

Add `import { currentSpendableBalance } from '@/domain/cashflow'` to the top of `src/tests/debt.test.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/tests/debt.test.ts`
Expected: FAIL — `netWorthCents` is not exported yet (`currentSpendableBalance` regression test should already pass since `cashflow.ts` isn't touched; only the `netWorthCents` test fails).

- [ ] **Step 3: Implement `netWorthCents`**

Add to `src/domain/debt.ts`:

```ts
import { currentSpendableBalance } from './cashflow'

export function netWorthCents(state: AppState): number {
  return currentSpendableBalance(state) - buildDebtSummary(state).totalOwedCents
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/tests/debt.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all clean, full suite passes (this also re-confirms no other test file broke).

- [ ] **Step 6: Commit**

```bash
git add src/domain/debt.ts src/tests/debt.test.ts
git commit -m "Add netWorthCents to debt domain module"
```

---

## Manual verification (per user request, before moving to Phase 2)

`buildDebtSummary`/`netWorthCents` have no UI surface yet, so verify by hand via the browser console or a scratch script using the sample household:

1. Run `pnpm dev:web`, open the app, click **Load sample data** (present at multiple places, e.g. onboarding screen and Settings) — this loads `createDemoState()`, which already includes a `credit-card` account with `openingBalanceCents: -52_300` (`src/domain/seed.ts:117-126`).
2. In the browser devtools console, since there's no UI hook yet, the fastest check is a temporary scratch test: create `src/tests/debt-manual-check.test.ts` (not committed) that imports `createDemoState`, `ensureCalculatedState`, and `buildDebtSummary`, logs the result with `console.log(JSON.stringify(buildDebtSummary(ensureCalculatedState(createDemoState())), null, 2))`, run it with `pnpm vitest run src/tests/debt-manual-check.test.ts`, inspect the output, then delete the scratch file.
