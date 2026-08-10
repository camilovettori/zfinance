import { detectTools, identifyBrowserSafeKey, isHttpsUrl, isLocalhostUrl, isServiceRoleKey, loadLocalEnv, maskKey, maskUrl } from './lib/sync-env.mjs'

function printTools() {
  console.log('Tools:')
  for (const tool of detectTools()) {
    if (tool.available) console.log(`- ${tool.name}: ${tool.version}`)
    else if (tool.name === 'Supabase CLI') console.log(`- ${tool.name}: missing (use pnpm dlx supabase@latest when needed)`)
    else console.log(`- ${tool.name}: missing`)
  }
}

function validateEnvironment(env) {
  const problems = []
  if (env.VITE_SYNC_ENABLED !== 'true') problems.push('VITE_SYNC_ENABLED must be true for cloud validation.')
  if (!env.VITE_SUPABASE_URL) problems.push('VITE_SUPABASE_URL is missing.')
  if (!env.VITE_SUPABASE_ANON_KEY) problems.push('VITE_SUPABASE_ANON_KEY is missing.')

  const allowLocalhost = env.HOMECOIN_ALLOW_LOCALHOST_SUPABASE === 'true'
  if (env.VITE_SUPABASE_URL) {
    if (!isHttpsUrl(env.VITE_SUPABASE_URL)) problems.push('VITE_SUPABASE_URL must be a valid HTTPS URL.')
    if (isLocalhostUrl(env.VITE_SUPABASE_URL) && !allowLocalhost) problems.push('Localhost Supabase URLs are blocked unless HOMECOIN_ALLOW_LOCALHOST_SUPABASE=true.')
  }

  if (env.VITE_SUPABASE_ANON_KEY) {
    if (isServiceRoleKey(env.VITE_SUPABASE_ANON_KEY)) problems.push('VITE_SUPABASE_ANON_KEY must never be a service-role or secret key.')
    const type = identifyBrowserSafeKey(env.VITE_SUPABASE_ANON_KEY)
    if (type === 'unknown') problems.push('VITE_SUPABASE_ANON_KEY must be an anon or publishable key.')
  }

  return problems
}

const env = loadLocalEnv()
const problems = validateEnvironment(env)

console.log(`Supabase URL: ${env.VITE_SUPABASE_URL ? maskUrl(env.VITE_SUPABASE_URL) : 'missing'}`)
console.log(`Supabase key: ${env.VITE_SUPABASE_ANON_KEY ? `${identifyBrowserSafeKey(env.VITE_SUPABASE_ANON_KEY)}, ${maskKey(env.VITE_SUPABASE_ANON_KEY)}` : 'missing'}`)
console.log(`Sync enabled: ${env.VITE_SYNC_ENABLED === 'true' ? 'yes' : 'no'}`)
printTools()

if (problems.length) {
  console.error('Environment is not ready for cloud sync validation:')
  for (const problem of problems) console.error(`- ${problem}`)
  process.exitCode = 1
}
