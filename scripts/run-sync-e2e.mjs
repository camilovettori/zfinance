import { spawnSync } from 'node:child_process'
import { loadLocalEnv, isLocalhostUrl } from './lib/sync-env.mjs'

const env = loadLocalEnv()
const configured = env.VITE_SYNC_ENABLED === 'true' && env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY

function run(command, args) {
  const result = process.platform === 'win32'
    ? spawnSync('cmd', ['/d', '/s', '/c', [command, ...args].join(' ')], {
      stdio: 'pipe',
      env: { ...process.env, ...env },
      shell: false,
      encoding: 'utf8',
    })
    : spawnSync(command, args, {
      stdio: 'pipe',
      env: { ...process.env, ...env },
      shell: false,
      encoding: 'utf8',
    })
  if (result.error) {
    console.error(result.error.message)
  }
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return result
}

if (!configured) {
  console.log('test:e2e:sync skipped because cloud sync is not configured locally.')
  process.exit(0)
}

if (isLocalhostUrl(env.VITE_SUPABASE_URL) && env.HOMECOIN_ALLOW_LOCALHOST_SUPABASE !== 'true') {
  console.log('test:e2e:sync skipped because localhost validation is not enabled for cloud sync.')
  process.exit(0)
}

if (!env.HOMECOIN_TEST_USER_A_EMAIL || !env.HOMECOIN_TEST_USER_A_PASSWORD || !env.HOMECOIN_TEST_USER_B_EMAIL || !env.HOMECOIN_TEST_USER_B_PASSWORD) {
  console.log('test:e2e:sync skipped because test user credentials are missing from the local environment.')
  process.exit(0)
}

const build = run('pnpm', ['build:web'])

if ((build.status ?? 1) !== 0) process.exit(build.status ?? 1)

const result = run('pnpm', ['exec', 'playwright', 'test', 'e2e/sync-real.spec.ts', '--reporter=list', '--workers=1'])

process.exit(result.status ?? 1)
