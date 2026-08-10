# HomeCoin

HomeCoin is a private, local-first household finance planner for desktop, phone, and tablet. The same React application runs as a Windows Tauri app and as an installable offline PWA.

## What is implemented

- Continuous weekly Planner with carried opening/closing balances.
- Mobile Planner views: Week, Day, and Month overview.
- Five-item mobile bottom navigation with safe-area support.
- Responsive Dashboard, Bills cards, Reports, forms, dialogs, onboarding, and Settings.
- Installable PWA with offline app shell and controlled update prompt.
- Web persistence in IndexedDB through Dexie.
- Automatic one-time migration from `homecoin:web-state`; the old value is temporarily retained as recovery backup.
- Desktop persistence in SQLite through Tauri.
- JSON backup/restore, PDF, print, and CSV.
- Optional Supabase Auth and per-entity shared-household sync, disabled by default.
- Explicit backed-up local upload, bounded retry, optimistic conflicts, soft deletes, and post-pull Realtime.

Money remains integer cents and financial dates remain `YYYY-MM-DD`.

## Run

```powershell
pnpm install
pnpm dev:web       # browser development
pnpm dev           # Tauri desktop development
pnpm build:web     # production web/PWA bundle
pnpm preview       # serve the production PWA locally
pnpm build         # Tauri executable and Windows installer
```

Optional sharing in web/PWA uses `.env.local` (never commit real values):

```dotenv
VITE_SYNC_ENABLED=true
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

Apply `supabase/migrations/202608060001_shared_households.sql` with the Supabase CLI before enabling it. Missing/invalid variables fall back to local-only without requests. The smoke and sync auth checks expect the test users to already exist in Supabase Auth and to use email/password login, with confirmed e-mail when that policy is enabled. Tauri phase 1 intentionally remains local-only on SQLite.

For phone testing on the same trusted network:

```powershell
pnpm dev:web --host 0.0.0.0
```

Open the computer's LAN IP and Vite port from the phone. Development HTTP permits UI testing, but PWA installation/service workers normally require HTTPS or localhost. Do not expose the dev server to an untrusted network.

## Install the PWA

1. Run `pnpm build:web`, then `pnpm preview --host 0.0.0.0` behind HTTPS for another device.
2. Android/desktop Chromium: use **Install HomeCoin** or the browser install action.
3. iPhone/iPad Safari: Share → **Add to Home Screen**.

Removing the PWA may also remove its IndexedDB data. Export a JSON backup first.

## Local data

| Runtime | Primary storage | Recovery |
|---|---|---|
| Web/PWA | IndexedDB `homecoin-local` | temporary `localStorage` mirror |
| Tauri | SQLite `sqlite:homecoin.db` | JSON backup |

The first web load migrates a valid legacy `homecoin:web-state` only if IndexedDB has no current state. It never overwrites valid IndexedDB data. The legacy mirror is intentionally retained for one stable release and is documented for later removal in [LOCAL_FIRST.md](docs/LOCAL_FIRST.md).

## Validation

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build:web
pnpm test:pwa
pnpm test:e2e
pnpm sync:check
pnpm sync:auth-check
pnpm sync:smoke
pnpm test:e2e:sync
pnpm security:scan-build
pnpm build
```

## Synchronization status

`VITE_SYNC_ENABLED` defaults to false. When explicitly enabled with both browser-safe variables, Settings → Sharing & sync provides Auth, households, owner/member invitations, explicit local migration, per-entity push/pull, conflicts, and Realtime. The complete setup and rollback are in [SYNC_ARCHITECTURE.md](docs/SYNC_ARCHITECTURE.md) and [SUPABASE.md](docs/SUPABASE.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Mobile](docs/MOBILE.md)
- [PWA](docs/PWA.md)
- [Local-first storage](docs/LOCAL_FIRST.md)
- [Sync architecture](docs/SYNC_ARCHITECTURE.md)
- [Supabase preparation](docs/SUPABASE.md)
- [Security](docs/SECURITY.md)
- [Roadmap](docs/ROADMAP.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
