# Supabase setup

Supabase is optional and disabled by default. Only the public anonymous key belongs in the client; never place `service_role`, a database password, or an access/refresh token in the repository or Vite variables.

## Local project

1. Install the Supabase CLI and Docker.
2. From the repository root run `supabase start`.
3. Apply [the phase-1 migration](../supabase/migrations/202608060001_shared_households.sql) with `supabase db reset` for a disposable local database, or `supabase db push` for a linked reviewed project.
4. In Supabase Auth, enable email/password and configure the Site URL/allowed redirect URLs for the HTTPS HomeCoin host.
5. Copy `.env.example` to `.env.local` and set only:

```dotenv
VITE_SYNC_ENABLED=true
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

For the local CLI URL, localhost HTTP is accepted. Non-local URLs must be HTTPS. Restart Vite after changing variables. If either variable is absent or invalid, HomeCoin falls back to local-only and makes no request.

The validation helpers read `.env.local` and `.env.test.local` directly:

- `pnpm sync:check`
- `pnpm sync:auth-check`
- `pnpm sync:smoke`
- `pnpm sync:invite-smoke`
- `pnpm test:e2e:sync`
- `pnpm security:scan-build`

Set `HOMECOIN_ALLOW_LOCALHOST_SUPABASE=true` only when you intentionally want to validate a localhost Supabase target.
Set `HOMECOIN_SMOKE_CLEANUP=true` when you want the smoke scripts to remove only smoke-namespace households they created after a successful run.

`pnpm sync:smoke` is the repeatable core smoke. It reuses an already shared smoke household when one exists and avoids creating new invitations on every run.

`pnpm sync:invite-smoke` is the separate invite lifecycle smoke. Run it less often; it intentionally exercises invitation creation, acceptance, wrong-email rejection, single-use enforcement, and owner-only invite rules. If Supabase reports `Invitation rate limit reached`, stop and retry later instead of looping.

## Tables

The migration creates:

- `households` and authenticated `household_members`;
- expiring, one-time `household_invites` with SHA-256 token hashes;
- `financial_accounts`, `categories`, `transactions`, `recurring_rules`, and shared `settings`;
- `sync_audit_events` with action metadata but no complete financial payloads.

Every synchronized row has UUID `id`, `household_id`, created/updated timestamps and users, integer `version`, nullable `deleted_at`, `client_updated_at`, and optional `device_id`. Entity payloads remain separate rows. Money stays integer cents; financial dates remain `YYYY-MM-DD` in the validated payload.

## Auth and household RPCs

- `create_household`: inserts household and owner membership atomically;
- `list_my_households`: returns only active memberships;
- `create_household_invite`: owner-only, at most ten/hour, expiry within seven days;
- `accept_household_invite`: authenticated email must match, locks and consumes token once;
- `remove_household_member`: owner-only soft removal;
- `leave_household`: member leaves; an owner promotes the oldest member or soft-deletes an empty household.

The frontend implements sign-up, login, local logout, password-reset email, persisted/auto-refreshed SDK sessions, loading, expired-session messaging, and human-readable errors.

## RLS

RLS is enabled on every remote table. Security-definer membership helpers run with a fixed empty search path and row security disabled only for their membership lookup. Policies allow members to read/write finance rows within their household, allow only owners to manage invitations/membership through RPCs, require the authenticated user for audit authorship, and define no physical DELETE policy. Insert/update triggers impose `created_by`/`updated_by`; the browser cannot impersonate another user.

## Test with two users

1. Create and confirm `owner@example.test` and `member@example.test` in a local Supabase project.
2. Sign in as owner in browser profile A, create a household, create a 48-hour invite, and copy its one-time URL.
3. Open profile B, sign in with the invited email, accept the invite, then verify the same household is listed.
4. Create/update a small integer-cent transaction in each profile, test offline edit/reconnect, then deliberately edit the same row/version to open Conflict.
5. Confirm a member cannot remove another member or create an invite, while the owner can.
6. Create a second household in profile A and verify profile B cannot select/read/update its rows through REST.
7. Run pgTAP policy checks in `supabase/tests/rls.sql` with seeded UUIDs using `supabase test db`.

Never run cross-household tests with production financial data.

## Realtime

The migration adds phase-1 tables to `supabase_realtime` when the publication exists. The client subscribes only after queue processing and initial pull. Realtime is not a replacement for pull.

## Rollback

For an application rollback, set `VITE_SYNC_ENABLED=false`, rebuild, and keep IndexedDB/SQLite intact. Export local JSON and a managed PostgreSQL backup before any schema rollback. Do not drop remote tables to roll back a frontend release; first disable Realtime and the feature flag, preserve rows, then apply a separately reviewed forward migration.

The step-by-step rollback notes are in [SUPABASE_ROLLBACK.md](SUPABASE_ROLLBACK.md) and the manual live checklist is in [SUPABASE_LIVE_VALIDATION.md](SUPABASE_LIVE_VALIDATION.md).
