import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const dotenvPattern = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/

function parseDotEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const content = readFileSync(filePath, 'utf8')
  const result = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = rawLine.match(dotenvPattern)
    if (!match) continue
    const [, key, rawValue] = match
    let value = rawValue.trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

export function loadLocalEnv() {
  const cwd = process.cwd()
  return {
    ...parseDotEnvFile(resolve(cwd, '.env.local')),
    ...parseDotEnvFile(resolve(cwd, '.env.test.local')),
    ...process.env,
  }
}

export function maskUrl(value) {
  try {
    const url = new URL(value)
    const host = url.hostname
    if (host === 'localhost' || host === '127.0.0.1') return `${url.protocol}//${host}`
    const [first, ...rest] = host.split('.')
    const suffix = rest.join('.')
    const prefix = first.length <= 3 ? first : `${first.slice(0, 3)}...`
    return `${url.protocol}//${prefix}${suffix ? `.${suffix}` : ''}`
  } catch {
    return 'unavailable'
  }
}

export function maskKey(value) {
  if (!value) return 'missing'
  const tail = value.slice(-4)
  return `configured, ending in ...${tail}`
}

export function isServiceRoleKey(value) {
  if (!value) return false
  if (/service[_-]?role/i.test(value) || value.startsWith('sb_secret_')) return true
  const payload = value.split('.')[1]
  if (!payload) return false
  try {
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/')
    const decoded = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'))
    return decoded.role === 'service_role'
  } catch {
    return false
  }
}

export function identifyBrowserSafeKey(value) {
  if (!value) return 'missing'
  if (value.startsWith('sb_publishable_')) return 'publishable'
  if (value.startsWith('sb_secret_')) return 'secret'
  if (isServiceRoleKey(value)) return 'service-role'
  const payload = value.split('.')[1]
  if (!payload) return 'unknown'
  try {
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/')
    const decoded = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'))
    if (decoded.role === 'anon' || decoded.role === 'authenticated') return 'anon'
  } catch {
    return 'unknown'
  }
  return 'unknown'
}

export function isHttpsUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

export function isLocalhostUrl(value) {
  try {
    const url = new URL(value)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

export function normalizeSupabaseUrl(value) {
  return new URL(value).origin
}

export function toolVersion(command, args = ['--version']) {
  const result = process.platform === 'win32'
    ? spawnSync('cmd', ['/d', '/s', '/c', [command, ...args].join(' ')], { encoding: 'utf8', shell: false })
    : spawnSync(command, args, { encoding: 'utf8', shell: false })
  if (result.status === 0) return result.stdout.trim() || result.stderr.trim() || 'available'
  return null
}

export function detectTools() {
  const pnpmMatch = process.env.npm_config_user_agent?.match(/pnpm\/([^\s]+)/)
  const tools = [
    { name: 'Node', version: process.version },
    { name: 'pnpm', version: pnpmMatch?.[1] ?? toolVersion('pnpm') },
    { name: 'Supabase CLI', version: toolVersion('supabase') },
    { name: 'Docker', version: toolVersion('docker') },
    { name: 'psql', version: toolVersion('psql') },
  ]
  return tools.map((tool) => ({
    ...tool,
    available: Boolean(tool.version),
  }))
}
