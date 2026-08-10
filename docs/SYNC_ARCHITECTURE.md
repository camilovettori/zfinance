# Sync architecture

HomeCoin is local-first. Sync is an optional transport, never the source required to use the application. `VITE_SYNC_ENABLED=false` remains the default; with the flag off, missing, or invalid, no Supabase client is created and no request is made.

## Write path

1. Domain/UI validates the edit (including Zod at the sync boundary).
2. `AppState` is saved to SQLite (Tauri) or IndexedDB/Dexie (web/PWA).
3. React is updated immediately from the persisted local value.
4. When a web/PWA household is explicitly linked and migrated, `diffSyncEntities` queues independent entity operations.
5. `SyncCoordinator` pushes ready operations, records the server version, and removes only confirmed queue entries.

The remote unit is one row in `households`, `household_members`, `financial_accounts`, `categories`, `transactions`, `recurring_rules`, or `settings`. `app_state.payload` is never uploaded. Goals, attachments, imports, and advanced audit remain local in phase 1.

Device-only settings (theme, privacy display, lock state, backup timestamps/paths) are not uploaded. Shared settings contain locale, currency, week start, and financial-month start.

## Queue and retry

Dexie database `homecoin-local` version 2 contains:

- `syncQueue`: operation, payload, base version, attempts, next attempt, error, and status;
- `entitySyncMetadata`: confirmed version and originating device;
- `syncConflicts`: both local payload and remote row;
- `syncMigrations`: explicit local-upload record and backup checksum.

Retry uses exponential backoff from 1 second, capped at 60 seconds. The configurable default is five attempts; then the entry becomes `failed`. Reconnect events call push followed by pull. SQLite migration 2 creates equivalent durable tables without changing the desktop `app_state` source of truth; phase-1 cloud transport is intentionally enabled only for web/PWA.

## Optimistic concurrency and conflicts

Updates and soft deletes use `id`, `household_id`, and `version = baseVersion`. PostgreSQL increments `version` in a trigger. No returned row means conflict; HomeCoin keeps the queued local payload and stores the remote row.

- **Keep mine** creates a new update based on the observed remote version.
- **Use remote** applies the whole validated remote entity locally and removes the stale operation.
- **Cancel** closes the prompt without changing either financial payload.

Transactions never auto-merge amount, date, or status. Recurring rules never auto-merge. This also preserves virtual recurrence semantics and prevents a remote event from generating materialized future occurrences.

## Pull and Realtime

After an already-migrated household is selected, HomeCoin processes its queue, pulls each table by `updated_at` cursor, reconciles into IndexedDB, and only then subscribes to Realtime. Pending/failed/conflicted local entities are not overwritten. Tombstones remove the corresponding local row; no physical database delete is used.

Realtime is supplemental. Same-device events already confirmed at the same version are ignored. Offline recovery always works through deterministic push/pull.

## Existing local data

Login never uploads local data. **Upload current local data to household** first shows account/category/transaction/recurrence counts and duplicate detection. Confirmation downloads a checksum-protected JSON backup, records the migration, rebinds phase-1 entities to the selected household, queues rows individually, and starts push/pull. Cancel leaves local data unchanged.

## Status

The compact global indicator reports Local only, Offline, Syncing, Synced, Changes waiting, Failed, or Conflict. Routine status never opens a modal; conflict resolution is in Settings → Sharing & sync.

