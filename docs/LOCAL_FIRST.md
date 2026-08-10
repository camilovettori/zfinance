# Local-first storage

## Current sources of truth

- Web/PWA: Dexie database `homecoin-local`, `appState/current`.
- Tauri: SQLite `app_state` row 1.
- React: loaded `AppState`, recalculated before persistence.

Every critical commit awaits repository persistence before replacing React state. The UI exposes Loading, Saving, Saved locally, Save failed and Offline states.

## Legacy migration

On web load:

1. look for `appState/current` in IndexedDB;
2. only when empty, read `homecoin:web-state`;
3. validate the aggregate shape;
4. atomically write AppState, migration marker and metadata;
5. confirm IndexedDB write;
6. retain localStorage as temporary recovery mirror;
7. never import it again while valid IndexedDB data exists.

After at least one stable public release, remove the write mirror first, retain read-only recovery for another release, then remove the legacy key only after an explicit backup/migration notice.

## Backup and restore

Backup serializes the same AppState regardless of repository. Restore verifies SHA-256, recalculates, replaces the active repository state and updates React. It does not merge or duplicate transactions.

## Optional shared sync

Supabase phase 1 is implemented behind `VITE_SYNC_ENABLED=false`. IndexedDB remains primary and receives every write before `syncQueue`. The queue sends accounts, categories, transactions, recurring rules, household, memberships, and shared settings as independent versioned rows; it never uploads `app_state.payload`.

Login does not upload existing local data. The explicit migration shows counts/duplicates, downloads a checksum-protected backup, records the migration, and then queues entity rows. Pull and Realtime preserve pending/conflicted local payloads and tombstones. See [SYNC_ARCHITECTURE.md](SYNC_ARCHITECTURE.md).

Tauri continues using SQLite `app_state`; migration 2 adds durable sync metadata tables without registering a service worker or changing desktop behavior. Cloud transport is web/PWA-only in phase 1.
