# Mobile

## Breakpoints

- `0–639px`: phone; bottom sheets, card-style Bills, stacked Reports and touch-first Planner.
- `640–1023px`: tablet/compact shell; bottom navigation and responsive content.
- `1024px+`: desktop sidebar and the original seven-column Planner.

## Navigation

The phone/tablet bottom bar contains Home, Planner, a central Add button, Bills, and More. More exposes This Week, This Month, Recurring, Reports, Savings, and Settings. It uses `env(safe-area-inset-bottom)`, `aria-current`, visible focus and touch-sized controls. The header Add button opens the same amount-first sheet.

## Planner

- **Week**: consecutive-week navigation, a readable opening/closing summary, income/bills totals and compact day cards. Today and the selected day are highlighted.
- **Day**: date strip, totals, running balance, Add income, Add bill and Move to date. Paid/Received can be recorded directly, with saving feedback, error handling and the existing Undo toast.
- **Month**: a full calendar with month arrows, today/selection indicators, item counts and separate income/bill dots. Selecting a date opens its containing week, highlights the day and scrolls it into view, including weeks spanning two months or years.
- **Dashboard**: tapping a day in the seven-day chart opens that exact date in the Planner.

Mobile does not depend on drag: Move to date opens the existing date/scope confirmation and preserves Undo, overrides, tombstones and completed history.

## Forms and accessibility

Dialogs become bottom sheets on phones, use viewport-limited internal scrolling, 16px inputs and touch-sized controls. Quick entry, More, forms and drawers lock background scrolling, contain keyboard focus, support Escape and restore focus when closed. Short screens can scroll the sheet while its primary actions remain reachable. Viewport configuration supports device safe areas and keyboard resizing without disabling zoom.

Quick entry parses integer cents, retains the selected Planner date and passes both to the form. Its close control and disabled zero-amount state are explicit. Balance/status updates use live regions, navigation is labelled and reduced motion is respected.

The forecast uses a full-width current balance and two compact month/year cards on phones. Navigation and forms were checked at 320, 360, 390, 430 and 768px, with short-screen entry, selected-date persistence, direct payment, focus restoration and offline reload covered in browser tests.

## Responsive screens

- Dashboard cards stack and charts use the compact window.
- Bills becomes labelled disclosure cards rather than a wide table.
- Reports stacks daily planner content on screen while print/PDF remain landscape.
- Onboarding, Settings, Recurring and Savings use existing responsive grids and bottom-sheet dialogs.

