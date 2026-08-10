# PWA

HomeCoin uses `vite-plugin-pwa` with a generated Workbox service worker.

## Manifest and cache

- standalone display, HomeCoin theme/background colours, 256/512 and maskable icons;
- app-shell precache for HTML, JS, CSS, icons and local assets;
- navigation fallback to `index.html`;
- cleanup of obsolete caches;
- no API, backup, export or remote financial-data caching rule.

## Updates

Registration uses prompt mode. A new worker shows **New version available** with **Update now** and **Later**. HomeCoin never forces a reload during editing.

## Installation

Chromium receives the native `beforeinstallprompt` action. iOS receives Share → Add to Home Screen guidance. A dismissal is remembered for seven days. The prompt is hidden in standalone mode.

## Offline

After one successful production load, the app shell opens offline and IndexedDB supplies the financial state. The online indicator changes to **Offline · saved locally** and does not block edits.

## Tauri

PWA prompts and service-worker registration are not mounted when `__TAURI_INTERNALS__` is present. Tauri continues to load bundled assets and SQLite normally.

## Test

```powershell
pnpm test:pwa
```

This builds production output and verifies the manifest, maskable icon, worker and precached app shell.

## iOS limitations

iOS can evict site data under storage pressure and does not offer the Chromium install event. Always export a backup before removing the installed PWA or clearing Safari website data.

