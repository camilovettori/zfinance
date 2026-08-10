import { ensureCalculatedState } from '@/domain/calculations'
import type { AppState } from '@/domain/model'
import type { AppStateRepository, PersistenceMetadata } from '@/persistence/types'
import { isValidAppState } from '@/persistence/validation'
import { HomeCoinWebDatabase, webDatabase } from './db'
import { LEGACY_WEB_STATE_KEY, LOCAL_STORAGE_MIGRATION_KEY, migrateLegacyLocalStorage } from './migration'

export const ACTIVE_HOUSEHOLD_KEY = 'active-household-id'
const snapshotId = (householdId: string) => `household:${householdId}`

export class WebIndexedDbAppStateRepository implements AppStateRepository {
  readonly db: HomeCoinWebDatabase

  constructor(db: HomeCoinWebDatabase = webDatabase) {
    this.db = db
  }

  async load(): Promise<AppState | null> {
    await migrateLegacyLocalStorage(this.db)
    const activeHouseholdId = await this.getActiveHouseholdId()
    if (activeHouseholdId) {
      const active = await this.loadHousehold(activeHouseholdId)
      if (active) return active
    }
    const record = await this.db.appState.get('current')
    if (!record || !isValidAppState(record.payload)) return null
    const updatedAt = new Date().toISOString()
    await this.db.transaction('rw', this.db.appState, this.db.metadata, async () => {
      await this.db.appState.put({ ...record, id: snapshotId(record.payload.household.id) })
      await this.db.metadata.put({ key: ACTIVE_HOUSEHOLD_KEY, value: record.payload.household.id, updatedAt })
    })
    return record.payload
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
      await this.db.appState.put({
        id: snapshotId(calculated.household.id),
        schemaVersion: calculated.schemaVersion,
        payload: calculated,
        updatedAt,
      })
      await this.db.metadata.put({ key: ACTIVE_HOUSEHOLD_KEY, value: calculated.household.id, updatedAt })
      await this.db.metadata.put({ key: 'last-save', value: updatedAt, updatedAt })
    })
    // Temporary recovery mirror. IndexedDB remains the source of truth; remove this after a stable migration window.
    if (typeof window !== 'undefined') window.localStorage.setItem(LEGACY_WEB_STATE_KEY, JSON.stringify(calculated))
    return calculated
  }

  async loadHousehold(householdId: string): Promise<AppState | null> {
    const record = await this.db.appState.get(snapshotId(householdId))
    return record && isValidAppState(record.payload) && record.payload.household.id === householdId ? record.payload : null
  }

  async getActiveHouseholdId(): Promise<string | null> {
    const record = await this.db.metadata.get(ACTIVE_HOUSEHOLD_KEY)
    return typeof record?.value === 'string' ? record.value : null
  }

  async setActiveHouseholdId(householdId: string) {
    const updatedAt = new Date().toISOString()
    await this.db.metadata.put({ key: ACTIVE_HOUSEHOLD_KEY, value: householdId, updatedAt })
  }

  async activateHousehold(householdId: string): Promise<AppState | null> {
    const snapshot = await this.loadHousehold(householdId)
    if (!snapshot) return null
    const updatedAt = new Date().toISOString()
    await this.db.transaction('rw', this.db.appState, this.db.metadata, async () => {
      await this.db.appState.put({ id: 'current', schemaVersion: snapshot.schemaVersion, payload: snapshot, updatedAt })
      await this.db.metadata.put({ key: ACTIVE_HOUSEHOLD_KEY, value: householdId, updatedAt })
      await this.db.metadata.put({ key: 'last-save', value: updatedAt, updatedAt })
    })
    if (typeof window !== 'undefined') window.localStorage.setItem(LEGACY_WEB_STATE_KEY, JSON.stringify(snapshot))
    return snapshot
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
