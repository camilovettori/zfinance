import { ensureCalculatedState } from '@/domain/calculations'
import type { AppState } from '@/domain/model'
import type { AppStateRepository, PersistenceMetadata } from '@/persistence/types'
import { isValidAppState } from '@/persistence/validation'
import { HomeCoinWebDatabase, webDatabase } from './db'
import { LEGACY_WEB_STATE_KEY, LOCAL_STORAGE_MIGRATION_KEY, migrateLegacyLocalStorage } from './migration'

export class WebIndexedDbAppStateRepository implements AppStateRepository {
  readonly db: HomeCoinWebDatabase

  constructor(db: HomeCoinWebDatabase = webDatabase) {
    this.db = db
  }

  async load(): Promise<AppState | null> {
    await migrateLegacyLocalStorage(this.db)
    const record = await this.db.appState.get('current')
    return record && isValidAppState(record.payload) ? record.payload : null
  }

  async save(state: AppState): Promise<AppState> {
    const calculated = ensureCalculatedState(state)
    const updatedAt = new Date().toISOString()
    await this.db.transaction('rw', this.db.appState, this.db.metadata, async () => {
      await this.db.appState.put({
        id: 'current',
        schemaVersion: calculated.schemaVersion,
        payload: calculated,
        updatedAt,
      })
      await this.db.metadata.put({ key: 'last-save', value: updatedAt, updatedAt })
    })
    // Temporary recovery mirror. IndexedDB remains the source of truth; remove this after a stable migration window.
    if (typeof window !== 'undefined') window.localStorage.setItem(LEGACY_WEB_STATE_KEY, JSON.stringify(calculated))
    return calculated
  }

  async clear() {
    await this.db.transaction('rw', this.db.appState, this.db.syncQueue, this.db.metadata, async () => {
      await Promise.all([this.db.appState.clear(), this.db.syncQueue.clear(), this.db.metadata.clear()])
    })
  }

  async getMetadata(): Promise<PersistenceMetadata> {
    const [record, migration] = await Promise.all([
      this.db.appState.get('current'),
      this.db.migrationState.get(LOCAL_STORAGE_MIGRATION_KEY),
    ])
    return {
      source: 'indexeddb',
      schemaVersion: record?.schemaVersion ?? null,
      updatedAt: record?.updatedAt ?? null,
      migratedFromLocalStorage: Boolean(migration),
    }
  }
}
