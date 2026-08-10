import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { syncConfiguration } from './config'
import { HOMECOIN_SCHEMA } from './schema'

type SupabaseClientInstance = SupabaseClient

let client: SupabaseClientInstance | null = null

export function getSupabaseClient(): SupabaseClientInstance | null {
  if (!syncConfiguration.enabled) return null
  client ??= createClient<Record<string, never>, typeof HOMECOIN_SCHEMA>(syncConfiguration.url, syncConfiguration.anonKey, {
    db: {
      schema: HOMECOIN_SCHEMA,
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'homecoin-auth',
    },
  }) as unknown as SupabaseClient
  return client
}

export function resetSupabaseClientForTests() {
  client = null
}
