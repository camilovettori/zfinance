# Database

HomeCoin uses a local SQLite database.

- Database URL: `sqlite:homecoin.db`
- Migration entrypoint: `src/database/migrations.ts`
- Persistence service: `src/services/storage.ts`

## Storage Pattern

The app keeps one canonical serialized `AppState` row in `app_state`.

Additional tables store supporting records such as:

- schema migration history
- backups
- audit events
- forecast snapshots
- settings

This gives the app fast startup and simple restore semantics while still leaving room for structured data.

## Main Tables

### Core household data

- `household`
- `household_members`
- `financial_accounts`
- `categories`
- `merchants`
- `tags`

### Financial activity

- `transactions`
- `transaction_splits`
- `transaction_tags`
- `recurring_rules`
- `budgets`
- `budget_periods`
- `financial_goals`

### Operational records

- `imports`
- `import_rows`
- `attachments`
- `settings`
- `backups`
- `audit_events`
- `forecast_snapshots`

## Migration Strategy

`schema_migrations` tracks which versions have been applied.

At startup, the app:

1. opens the SQLite database
2. enables foreign keys
3. runs any unapplied migrations
4. loads or creates the in-memory state

## Data Notes

- Dates are stored as ISO strings.
- Monetary values are stored as integer cents.
- Boolean fields are stored as integers in SQLite and converted in the app layer.
- Backup records are append-only and are not overwritten.

## Restore Semantics

Backups restore the serialized app state rather than individual rows.

That approach is intentional:

- it matches the offline-first design
- it keeps restore logic simple
- it avoids partial state mismatches
