# Supabase live validation checklist

Use this checklist for a real development-project validation after `pnpm sync:check` reports a valid environment.

## Configuration

- [ ] Development Supabase project created.
- [ ] Auth email/password enabled.
- [ ] Site URL and redirect URLs configured.
- [ ] `.env.local` contains only browser-safe values.
- [ ] `VITE_SYNC_ENABLED=true`.
- [ ] `VITE_SUPABASE_URL` points to the development project.
- [ ] `VITE_SUPABASE_ANON_KEY` is public, not `service_role`, not `sb_secret_`.
- [ ] `supabase/migrations/202608060001_shared_households.sql` applied.
- [ ] `homecoin` schema migration applied.
- [ ] RLS enabled on the remote tables.

## User A

- [ ] Account created and confirmed.
- [ ] Signed in successfully.
- [ ] Household created or reused for the smoke namespace.
- [ ] Local data upload reviewed before migration.
- [ ] Migration backup downloaded with checksum.

## User B

- [ ] Account created and confirmed.
- [ ] Shares the core smoke household or accepts the invite-smoke household.
- [ ] Invitation accepted once during invite smoke.
- [ ] Access to the shared household confirmed.

## Sync

- [ ] Core smoke completes with shared-household access.
- [ ] Create operation pushed.
- [ ] Update operation pushed.
- [ ] Delete operation pushed as a tombstone.
- [ ] Manual pull works from the shared smoke household.
- [ ] Realtime receives remote changes after pull.
- [ ] Invite smoke is run separately when validating one-time invite behavior.

## Conflicts

- [ ] Keep mine works.
- [ ] Use remote works.
- [ ] Cancel leaves the conflict unresolved.

## Security

- [ ] Cross-household access is blocked.
- [ ] Owner-only member management is enforced.
- [ ] Expired invitation is rejected.
- [ ] Reused invitation is rejected.
- [ ] Wrong-email invitation acceptance is rejected.
- [ ] Removed user loses access.
- [ ] Bundle scan contains no secrets.

## PWA

- [ ] PWA installs.
- [ ] Offline reload preserves IndexedDB data.
- [ ] Queue survives a reload.
- [ ] Service worker updates without breaking local data.

## Tauri

- [ ] Desktop build remains local-only.
- [ ] No Supabase request is made in Tauri phase 1.
- [ ] SQLite storage still works.
- [ ] Service worker stays absent on desktop.

## Live validation commands

- `pnpm sync:auth-check` confirms that User A and User B can log in with email/password.
- `pnpm sync:smoke` runs the repeatable core sync smoke against an already shared smoke household. If no shared smoke household exists yet, it skips cleanly and tells you to seed one with invite smoke.
- `pnpm sync:invite-smoke` runs the invite lifecycle smoke separately and may be rate-limited by Supabase if run too often.
- `pnpm test:e2e:sync` validates the browser e2e path against the live Supabase project.

If `pnpm sync:invite-smoke` reports `Invitation rate limit reached`, stop there and wait for the rate limit window to reset. Do not retry in a loop and do not create additional invites just to force the command green.
