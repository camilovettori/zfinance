# Supabase rollback

Use this when you need to disable cloud sync or roll back a development validation without losing local HomeCoin data.

## Stop cloud sync

- Set `VITE_SYNC_ENABLED=false` in `.env.local`.
- Restart the app or rebuild the web bundle.
- The local IndexedDB and SQLite stores stay intact.
- Realtime subscriptions stop with the sync runtime.
- Queue processing stays dormant while the feature flag is off.

## Preserve local data

- Export a JSON backup before changing any remote schema.
- Keep IndexedDB and SQLite files untouched if you are only rolling back the sync feature.
- Do not delete the browser profile unless you intentionally want to remove local data too.

## Realtime and queue

- Realtime is only active after queue processing and an initial pull.
- To stop it during validation, sign out, leave the household, or turn the feature flag off.
- Pending queue entries remain local until sync is enabled again.

## Revert a development migration

Only do this in a disposable development project after you have a backup.

1. Export or snapshot the project data.
2. Review the tables affected by `supabase/migrations/202608060001_shared_households.sql`.
3. Revert the schema with the Supabase CLI or SQL editor only after confirming the backup.
4. Restore the household tables, invites, and membership rows from the backup if needed.

Do not add a destructive automatic rollback migration unless it has been explicitly reviewed.

## Session cleanup

- Revoke test invites by deleting the invite rows in the development project.
- Invalidate test sessions by signing the users out or removing the auth users in the development project.
- Rotate the anon key if it was exposed.
- Rotate any service-role secret only in the development project, never in the frontend.

