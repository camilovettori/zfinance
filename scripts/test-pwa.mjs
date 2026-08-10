import { readFile, access } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const manifestPath = path.join(root, 'dist', 'manifest.webmanifest')
const workerPath = path.join(root, 'dist', 'sw.js')
await Promise.all([access(manifestPath), access(workerPath)])

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.name !== 'HomeCoin' || manifest.display !== 'standalone') {
  throw new Error('HomeCoin PWA manifest is incomplete')
}
if (!manifest.icons?.some((icon) => icon.purpose === 'maskable')) {
  throw new Error('HomeCoin PWA manifest has no maskable icon')
}

const index = await readFile(path.join(root, 'dist', 'index.html'), 'utf8')
if (!index.includes('manifest.webmanifest')) throw new Error('Built app does not link the PWA manifest')

const worker = await readFile(workerPath, 'utf8')
if (!worker.includes('index.html')) throw new Error('Service worker does not precache the app shell')

process.stdout.write('PWA smoke test passed: manifest, maskable icon, service worker, and app shell are present.\n')
