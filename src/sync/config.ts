import { z } from 'zod'

const httpsUrl = z.string().url().refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1'
}, 'Supabase must use HTTPS (localhost is allowed for development)')

const isServiceRoleKey = (value: string) => {
  if (/service[_-]?role/i.test(value) || value.startsWith('sb_secret_')) return true
  const payload = value.split('.')[1]
  if (!payload) return false
  try {
    const decoded = JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/'))) as { role?: unknown }
    return decoded.role === 'service_role'
  } catch {
    return false
  }
}

const browserKey = z.string().min(20).refine(
  (value) => !isServiceRoleKey(value),
  'A service-role key must never be used in the client',
)

export type SyncConfiguration =
  | { enabled: false; reason: 'disabled' | 'missing-variables' | 'invalid-variables'; message: string }
  | { enabled: true; url: string; anonKey: string }

export function normalizeSupabaseUrl(value: string) {
  return new URL(value).origin
}

export function getSyncConfiguration(env: ImportMetaEnv = import.meta.env): SyncConfiguration {
  if (env.VITE_SYNC_ENABLED !== 'true') {
    return { enabled: false, reason: 'disabled', message: 'Cloud sync is off. HomeCoin is local only.' }
  }

  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    return {
      enabled: false,
      reason: 'missing-variables',
      message: 'Cloud sync needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. No request was made.',
    }
  }

  const parsed = z.object({ url: httpsUrl, anonKey: browserKey }).safeParse({
    url: env.VITE_SUPABASE_URL,
    anonKey: env.VITE_SUPABASE_ANON_KEY,
  })
  if (!parsed.success) {
    return {
      enabled: false,
      reason: 'invalid-variables',
      message: parsed.error.issues[0]?.message ?? 'Supabase configuration is invalid. No request was made.',
    }
  }

  return { enabled: true, url: normalizeSupabaseUrl(parsed.data.url), anonKey: parsed.data.anonKey }
}

export const syncConfiguration = getSyncConfiguration()
