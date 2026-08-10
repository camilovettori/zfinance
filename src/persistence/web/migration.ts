import type { AppState } from '@/domain/model'
import { isValidAppState } from '@/persistence/validation'
import type { HomeCoinWebDatabase } from './db'

export const LEGACY_WEB_STATE_KEY = 'homecoin:web-state'
export const LOCAL_STORAGE_MIGRATION_KEY = 'local-storage-app-state-v1'

type LegacyStorage = Pick<Storage, 'getItem' | 'setItem'>

export type MigrationResult = 'already-current' | 'migrated' | 'empty' | 'invalid'

export async function migrateLegacyLocalStorage(
  db: HomeCoinWebDatabase,
  storage: LegacyStorage | null = typeof window !== 'undefined' ? window.localStorage : null,
): Promise<MigrationResult> {
  if (await db.appState.get('current')) return 'already-current'
  if (!storage) return 'empty'

  const legacyPayload = storage.getItem(LEGACY_WEB_STATE_KEY)
  if (!legacyPayload) return 'empty'

  let state: AppState
  try {
    const parsed: unknown = JSON.parse(legacyPayload)
    if (!isValidAppState(parsed)) return 'invalid'
    state = parsed
  } catch {
    return 'invalid'
  }

  const now = new Date().toISOString()
  await db.transaction('rw', db.appState, db.metadata, db.migrationState, async () => {
    await db.appState.put({ id: 'current', schemaVersion: state.schemaVersion, payload: state, updatedAt: now })
    await db.metadata.put({ key: 'legacy-local-storage-retained', value: true, updatedAt: now })
    await db.migrationState.put({ key: LOCAL_STORAGE_MIGRATION_KEY, completedAt: now, source: LEGACY_WEB_STATE_KEY })
  })

  // Keep the old payload for one stable release as a recovery copy.
  storage.setItem(`${LEGACY_WEB_STATE_KEY}:migrated`, now)
  return 'migrated'
}

