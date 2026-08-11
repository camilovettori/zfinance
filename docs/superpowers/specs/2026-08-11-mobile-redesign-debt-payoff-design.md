# Mobile Redesign + Debt Payoff

## Problem

The mobile dashboard (`MobileDashboard.tsx` / `mobile-dashboard-model.ts`) renders five
independent cards (Available now, Tomorrow, Next income, Current week, Add actions) that
each answer a different question. The user has to do mental math to answer the one
question that matters: "can I spend or not?" Two more problems compound this:

1. `currentSpendableBalance()` in `cashflow.ts` only sums `current | joint | cash | manual`
   accounts — `credit-card`, `loan`, `financing` are excluded from every balance shown.
   `AccountType` already includes these three liability types (`domain/model.ts`), but no
   debt is ever calculated or displayed anywhere in the app, mobile or desktop.
2. The mobile Planner (`MobilePlannerView.tsx`) has three competing tabs (week/day/month)
   and opens on the first week of the cycle rather than the current week.

## Verified against the repo (2026-08-11)

Spot-checked the claims in the source plan directly against the current `main`:
- `mobile-dashboard-model.ts` and `MobileDashboard.tsx` match the described shape exactly
  (fields `availableNowCents`, `tomorrowItems`, `nextIncome`, `currentWeek`, `insight`).
- `cashflow.ts`'s `spendableAccountIds` filters to `['current','joint','cash','manual']` —
  liability types are excluded, confirmed.
- `domain/model.ts` `AccountType` already includes `'credit-card' | 'loan' | 'financing'`.
- `App.tsx:3276` is the `<MobileDashboard />` call site inside
  `activeSection === 'dashboard' ? mobileLayout ? <MobileDashboard ... />`, matching the
  plan's "around line 3276" reference.
- `src/app/planner/MobilePlannerView.tsx` exists at the stated path.
- `src/tests/responsive.test.ts` exists; its specific assertions (safe-area-inset,
  `--mobile-nav-height`, etc.) will be re-checked at the start of Phase 3/4 so nothing in
  that file regresses.

No material discrepancies found — the plan is implemented as specified, phase by phase.

## Approach

Four phases, run in order, checkpointed with the user after each (chosen over running all
four straight through, since Phases 3–4 rewrite user-facing UI and a mid-course correction
is cheaper than an end-of-run one):

**Phase 1 — Debt domain module** (`src/domain/debt.ts`, pure logic, no UI)
- `LIABILITY_ACCOUNT_TYPES`, `LiabilityAccountSummary`, `DebtSummary`, `buildDebtSummary()`.
- Owed amount is always `Math.abs(currentBalanceCents)` — robust to sign entry either way.
- Payoff pace: average of last 3 months of paid liability payments, falling back to active
  recurring rules targeting a liability account, normalized to monthly. Zero pace ⇒
  `monthsRemaining`/`payoffDateIso` stay `null` — never fabricate a payoff date.
- `netWorthCents()` = `currentSpendableBalance(state) - buildDebtSummary(state).totalOwedCents`.
- `cashflow.ts` behavior is unchanged; a regression test pins `spendableAccountIds`.
- Tests in `src/tests/debt.test.ts`.

**Phase 2 — Narrative dashboard model** (`mobile-dashboard-model.ts` rewrite, no component changes)
- Replaces the five-fact shape with a three-act `MobileDashboardModel`: Act 1 (where I
  stand: `safeToSpendCents`, `runwayDays`, `totalOwedCents`, `netWorthCents`), Act 2 (what
  comes next: a day-by-day `horizon: MoneyEvent[]` with running balance and a flagged low
  point, replacing the separate Tomorrow/Next-income cards), Act 3 (where I'm heading:
  `debt: DebtSummary` from Phase 1, and per-goal progress).
- `safeToSpendCents` is never clamped to zero — a negative value is real information.
- `headline`/`tone` derived by the first matching rule (negative-in-horizon → warning,
  thin margin → tight, debt/goal progress → good, default → good), returned as
  `{ template, values }` so the component controls money formatting/privacy masking.
- `buildMobileDashboardModel` keeps its exported name so nothing outside the model+component
  pair needs to change yet.
- Existing `mobile-dashboard.test.tsx` is migrated to the new shape; new cases added for
  empty horizon days, low-point flagging, negative safe-to-spend, and no-income households.

**Phase 3 — Mobile dashboard component rewrite** (`MobileDashboard.tsx` + `.mobile-*` CSS only)
- Renders the three acts: a single hero "Safe to spend" card (replacing 2 of the 5 cards),
  a vertical timeline replacing Tomorrow/Next-income, and a debt-vs-goal progress-bar
  section replacing nothing (net-new).
- Hard constraint, mechanically checkable: `git diff --stat` after this phase must show
  zero changes to `MonthlyPlanner.tsx`, and the only change inside `App.tsx` is the props
  passed at the `<MobileDashboard />` call site.
- CSS additions are restricted to `.mobile-*` selectors or existing mobile media queries;
  `responsive.test.ts`'s assertions are re-verified to still pass unchanged.
- Accessibility: `aria-live="polite"` on the hero, timeline as `<ol>`, `role="progressbar"`
  on every bar, low point conveyed by a text tag (not color alone).

**Phase 4 — Mobile planner simplification + desktop debt card**
- `MobilePlannerView.tsx`: drop the 3-tab control down to `Mode = 'week' | 'day'`, default
  to the week containing today (not week index 0), add a 7-pill day strip for orientation.
  No changes to `planner-actions.ts` or `MonthlyPlanner.tsx` (desktop planner untouched).
- Desktop: exactly one additive card in `App.tsx`'s existing dashboard grid, built from
  `buildDebtSummary(state)` (Phase 1) — no grid restructuring, no other desktop change
  beyond this card and the account-type helper text (which may already exist and need no
  change — verified at Phase 4 start, not invented as a change here).
- Hard constraint, mechanically checkable: `git diff --stat` limited to the new debt card
  and (if needed) the helper text — nothing else in `App.tsx`'s desktop layout changes.

## Out of scope (explicit non-goals from the source plan)

No charts on mobile, no gamification (streaks/badges), never hide a negative number, no
new user-entered data fields, no desktop changes beyond the one debt card.

## Testing

Each phase ends with `pnpm typecheck && pnpm lint && pnpm test`; Phases 3–4 additionally
run `pnpm build:web` (and Phase 4 also `pnpm build`) since they're UI-facing. Phase 3 and 4
each end with a `git diff --stat` check confirming the desktop-untouched constraint holds.
