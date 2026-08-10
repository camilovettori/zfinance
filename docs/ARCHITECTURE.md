# Architecture

HomeCoin is one React 19 + TypeScript application with two local runtime adapters.

```text
React UI
  ├─ desktop shell + seven-column Planner
  ├─ mobile shell + Week/Day/Month Planner
  ├─ pure financial domain
  └─ AppStateRepository
       ├─ TauriAppStateRepository → SQLite app_state.payload
       └─ WebIndexedDbAppStateRepository → Dexie/IndexedDB
```

## Layers

- `src/app`: shell, existing screens, desktop Planner, mobile navigation and mobile Planner.
- `src/domain`: calculations, recurrence expansion, cashflow, planning, deduplication, backup and imports. JSX does not own financial formulas.
- `src/persistence`: repository contracts, runtime selection, IndexedDB schema/migration and SQLite adapter.
- `src/services/storage.ts`: compatibility facade plus saving/saved/error notifications.
- `src/sync`: disabled provider, mock provider, operation contracts and IndexedDB queue.
- `src/pwa`: install and controlled-update UI. It is not mounted inside Tauri.

## AppState and money

The in-memory source of truth remains the existing aggregate `AppState`. This phase deliberately avoids risky entity-by-entity UI rewrites. Money is integer cents, financial dates are local `YYYY-MM-DD`, and audit timestamps are full ISO strings.

## Planner

Both layouts consume the same `PlanningWeek[]` produced by `buildPlanningWeeks()`:

- desktop: seven columns, drag/drop, print and cycle summary;
- mobile: vertical Week cards, detailed Day actions and compact Month overview;
- both: the same opening, income, bills, savings and closing values;
- `Move to date` remains available without drag and uses the existing occurrence/series rules.

## Runtime persistence

`createAppStateRepository()` selects by `__TAURI_INTERNALS__`:

- Tauri → `TauriAppStateRepository` and SQLite;
- browser/PWA → `WebIndexedDbAppStateRepository` and Dexie.

IndexedDB stores `appState`, `syncQueue`, `metadata`, and `migrationState`. SQLite stays compatible with `app_state.payload` and the legacy database migration.

## PWA boundary

`vite-plugin-pwa` generates the manifest and Workbox service worker. `PwaPrompts` mounts only when `isTauriRuntime()` is false, preventing service-worker registration in the desktop webview.

## Future multi-user boundary

The current aggregate is not uploaded. Future synchronization must map entities into versioned household rows, enqueue entity operations locally, use authenticated RLS, and surface conflicts instead of overwriting either version.

