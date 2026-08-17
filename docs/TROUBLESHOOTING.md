# Troubleshooting

## Sync says Local only

This is the safe default. Set all three variables in `.env.local` and restart Vite:

```dotenv
VITE_SYNC_ENABLED=true
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

If variables are incomplete/invalid, HomeCoin deliberately creates no client and makes no request. Tauri phase 1 remains local-only on SQLite; use the web/PWA runtime for shared sync.

## Login or invitation fails

- confirm Email Auth and the user email in Supabase;
- add the exact HTTPS app origin to Auth redirect URLs;
- an invitation must be accepted by its addressed email before expiry and only once;
- ask the owner for a new URL if it expired/was used;
- do not paste tokens into logs or support messages.

## Changes are waiting / failed

Offline changes are safe in Dexie. HomeCoin retries automatically on reconnect, focus, and its 60-second sync cycle; **Sync now** remains available as a manual override. Retries use exponential backoff capped at 30 seconds. Check browser network reachability and the Supabase project state. Do not clear IndexedDB: that would remove the queue. Failed entries left by older builds are revived by the next full sync.

## Conflict appears

Open Settings → Sharing & sync. **Keep mine** resubmits the complete local entity against the latest remote version. **Use remote** replaces that entity locally. **Cancel** makes no payload change. Transaction amount/date/status and recurring rules are never auto-merged. Export a JSON backup first if uncertain.

## Local upload detects duplicates

Detection checks entity IDs and normalized account/category names plus transaction/recurrence name, cents, and financial date. Semantic duplicates are skipped; same-ID rows are optimistic updates. Review the counts, keep the automatically downloaded pre-sync backup, and cancel if the selected household is wrong.

## Web data did not migrate

Open developer tools → Application and check IndexedDB `homecoin-local`. Legacy migration reads `homecoin:web-state` only when `appState/current` is empty and valid. Export before clearing anything.

## PWA does not install or open offline

- use `pnpm build:web` followed by `pnpm preview`;
- use HTTPS or localhost;
- load once online so Workbox installs;
- on iOS use Share → Add to Home Screen;
- run `pnpm test:pwa` to verify manifest/worker output.

## Tauri or backup fails

Install Rust stable, WebView2, and Visual Studio Build Tools C++. Use `pnpm dev`/`pnpm build`. Desktop backup requires `Documents/HomeCoin/Backups` permission. Backup imports are checksum-validated; do not edit JSON manually.

## Roll back sync safely

Export local JSON, set `VITE_SYNC_ENABLED=false`, rebuild, and leave local/remote rows intact. This immediately returns the client to local-only without clearing SQLite/IndexedDB. Take a managed PostgreSQL backup before any reviewed forward schema rollback.

## Full verification

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:pwa
pnpm test:e2e
pnpm sync:check
pnpm sync:smoke
pnpm test:e2e:sync
pnpm security:scan-build
pnpm build:web
pnpm build
```
