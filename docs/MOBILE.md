# Mobile

## Breakpoints

- `0–639px`: phone; bottom sheets, card-style Bills, stacked Reports and touch-first Planner.
- `640–1023px`: tablet/compact shell; bottom navigation and responsive content.
- `1024px+`: desktop sidebar and the original seven-column Planner.

## Navigation

The phone/tablet bottom bar contains Home, Planner, Bills, Reports, and More. More exposes This Week, This Month, Recurring, Savings, and Settings. It uses `env(safe-area-inset-bottom)`, `aria-current`, visible focus and 44px minimum controls.

## Planner

- **Week**: primary phone view, consecutive-week navigation, opening/income/bills/closing and seven vertical day cards.
- **Day**: totals, running balance, item actions, Add income, Add bill and Move to date.
- **Month overview**: compact daily totals, item count and negative-balance indicator; long names are omitted.

The desktop Planner is untouched and keeps drag/drop. Mobile does not depend on drag: Move to date opens the existing date/scope confirmation and preserves Undo, overrides, tombstones and completed history.

## Forms and accessibility

Dialogs become bottom sheets on phones, use viewport-limited internal scrolling, 16px inputs and touch-sized controls. Escape remains supported on desktop. Balance/status updates use live regions, navigation is labelled, reduced motion is respected, and no state relies only on colour.

## Responsive screens

- Dashboard cards stack and charts use the compact window.
- Bills becomes labelled disclosure cards rather than a wide table.
- Reports stacks daily planner content on screen while print/PDF remain landscape.
- Onboarding, Settings, Recurring and Savings use existing responsive grids and bottom-sheet dialogs.

