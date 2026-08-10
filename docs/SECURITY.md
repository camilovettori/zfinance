# Security

HomeCoin remains local-first and sends nothing externally by default.

## Client and transport

- `VITE_SYNC_ENABLED=false` is the default.
- A Supabase client is created only when URL and anon key both validate; production URLs require HTTPS.
- The official SDK persists and refreshes the session. Logout uses local SDK scope and never deletes financial storage.
- `service_role`, database passwords, invite hashes, and user tokens are never accepted as client configuration or logged.
- Logs and audit metadata must not contain complete amounts, full financial payloads, credentials, or invitation tokens.
- PWA cache contains the app shell, not Supabase financial responses, exports, or backup files.

## Authorization and database integrity

The versioned migration enables RLS on all remote tables. Household membership scopes reads/writes; owner-only security-definer RPCs manage invites and members. Fixed `search_path`, explicit grants/revokes, and row-security settings limit definer functions. Before-insert/update triggers impose authenticated authorship and increment versions. No DELETE policy exists; removal is a tombstone.

Invitation tokens use 256 bits of browser randomness, are stored only as SHA-256 hashes, expire within seven days (UI defaults to 48 hours), match the authenticated email, and are consumed under row lock. Invite creation is limited to ten per owner/hour in PostgreSQL.

Zod validates auth input and every remote entity. Monetary values are safe integers; financial dates match `YYYY-MM-DD`; timestamps use full ISO. SQL queries use the Supabase query builder/RPC parameters or Tauri `$1` parameters.

## Local data risks

IndexedDB, SQLite, SDK session storage, and JSON backups are not end-to-end encrypted. Anyone with access to an unlocked OS/browser profile may read them. Use screen lock/disk encryption, keep browsers/WebView2 current, export private backups, and do not use a shared browser profile. Removing a PWA can remove IndexedDB; export first.

## Operational checklist

- test RLS with two distinct authenticated users and two households;
- review the SQL migration before `supabase db push`;
- use HTTPS hosting with CSP/security headers;
- enable managed PostgreSQL backups and practice restore/export;
- rotate an exposed anon key and invalidate sessions if needed; a leaked `service_role` requires immediate rotation and incident review;
- keep sync disabled until the target environment passes typecheck, tests, PWA checks, two-user RLS tests, and backup/rollback drills.
- run `pnpm security:scan-build` before sharing a web bundle;
- use the live checklist in [SUPABASE_LIVE_VALIDATION.md](SUPABASE_LIVE_VALIDATION.md) and the rollback notes in [SUPABASE_ROLLBACK.md](SUPABASE_ROLLBACK.md).

Phase-1 limitation: Tauri continues local-only on SQLite while shared transport runs in web/PWA. Optional encryption, local biometric/PIN gate, and richer audit review remain future hardening.
