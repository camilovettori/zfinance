import { spawnSync } from 'node:child_process'

// Responsive/offline tests must exercise local mode even when .env.local enables sync.
const env = { ...process.env, VITE_SYNC_ENABLED: 'false' }
const packageManager = process.env.npm_execpath
if (!packageManager) throw new Error('Run this script through pnpm test:e2e.')

for (const args of [
  ['build:web'],
  ['exec', 'playwright', 'test', 'e2e/responsive.spec.ts', 'e2e/whatsapp.spec.ts', 'e2e/receipt-scanner.spec.ts'],
]) {
  const result = spawnSync(process.execPath, [packageManager, ...args], { env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
