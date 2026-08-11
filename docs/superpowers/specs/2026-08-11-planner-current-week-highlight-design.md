# Highlight Current Week in Planner

## Problem

In `MonthlyPlannerView`, when multiple weeks are rendered (monthly view), there's no visual cue for which week is "now." The user has to read date labels to orient themselves. The "This Week" dashboard page already solves this for today's day card (sage border via `data-today`); the Planner has no equivalent for weeks, or for today's day column within the week grid.

## Approach

Reuse the date helpers already in `src/lib/date.ts` (`todayIso()`, `isIsoBetween()`) rather than re-deriving `toIsoDate(new Date())` inline, and mirror the existing `data-today` convention already used in `App.tsx:2555` / `style.css:693` for the "This Week" cards. `MonthlyPlanner.tsx` is written in a dense, single-line JSX style — new code follows that style rather than reformatting into multi-line JSX.

## Changes

**`src/app/MonthlyPlanner.tsx`**
- Import `isIsoBetween`, `todayIso` from `@/lib/date`.
- `PlanningDayColumn`: add `data-today={day.date === todayIso()}` on the day `<article>`.
- `MonthlyPlannerView`: on the week `<section className="planning-week">`, add `data-current-week={isIsoBetween(todayIso(), week.start, week.end)}` alongside the existing `data-week-start`. In the heading `<small>`, show `● Current week` when that week is current; otherwise fall back to the existing `Week N` / `Weekly plan` logic (both branches keep their current behavior).
- Add a `ref` on `.planning-week-list` and a `useEffect` that, when `weeks` changes, finds `[data-current-week='true']` and calls `scrollIntoView({ behavior: 'smooth', block: 'start' })` if present.

**`src/style.css`**
- After the `.planning-week` block (~line 784): sage left border + faint tint background on `.planning-week[data-current-week='true']`, a sage pill badge on its heading `<small>`, accent-colored `<h3>`.
- Near the existing `.planning-day > header` rules (~line 795): green top border on `.planning-day[data-today='true']` and a sage badge on its header `<strong>`, matching `.week-day-card[data-today='true'] .week-day-heading strong` (~line 693).
- In the existing `@media print` block (~line 1114-1179): reset all of the above to no color/border so printed reports are unaffected.

## Out of scope

No changes to `PlanningWeek`/`PlanningDay` types, balance calculations, drag-and-drop, grid layout, or the `data-week-start` attribute.

## Testing

- Existing tests in `src/tests/planner-actions.test.ts` (and any other planner tests) must keep passing.
- Manual check: current week has sage border + badge, today's day column highlighted, past/future weeks unchanged, auto-scroll on mount with multiple weeks, print view has no color.
- `pnpm typecheck && pnpm lint && pnpm test`
