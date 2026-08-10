import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isBackupPayload, serializeBackup, validateBackupPayload } from '@/domain/backup'
import { createDemoState } from '@/domain/seed'
import {
  createAppStateRepository,
  HomeCoinWebDatabase,
  migrateLegacyLocalStorage,
  TauriAppStateRepository,
  WebIndexedDbAppStateRepository,
  setAppStateRepositoryForTests,
  type AppStateRepository,
} from '@/persistence'
import { getPersistenceStatus, saveState, subscribePersistenceStatus } from '@/services/storage'

let db: HomeCoinWebDatabase
let repository: WebIndexedDbAppStateRepository

beforeEach(() => {
  window.localStorage.clear()
  db = new HomeCoinWebDatabase(`homecoin-test-${crypto.randomUUID()}`)
  repository = new WebIndexedDbAppStateRepository(db)
})

afterEach(async () => {
  setAppStateRepositoryForTests(null)
  db.close()
  await db.delete()
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

describe('local-first repositories', () => {
  it('saves and reloads the aggregate AppState in IndexedDB', async () => {
    const expected = createDemoState()
    await repository.save(expected)
    const loaded = await repository.load()

    expect(loaded?.household.id).toBe(expected.household.id)
    expect(loaded?.transactions).toHaveLength(expected.transactions.length)
    expect((await repository.getMetadata()).source).toBe('indexeddb')
  })

  it('migrates valid localStorage once and retains the legacy recovery copy', async () => {
    const legacy = createDemoState()
    window.localStorage.setItem('homecoin:web-state', JSON.stringify(legacy))

    expect(await migrateLegacyLocalStorage(db)).toBe('migrated')
    expect(await migrateLegacyLocalStorage(db)).toBe('already-current')
    expect((await repository.load())?.household.id).toBe(legacy.household.id)
    expect(window.localStorage.getItem('homecoin:web-state')).toBeTruthy()
    expect((await repository.getMetadata()).migratedFromLocalStorage).toBe(true)
  })

  it('never replaces valid IndexedDB data with stale or invalid localStorage', async () => {
    const current = createDemoState()
    current.household.name = 'IndexedDB household'
    await repository.save(current)
    window.localStorage.setItem('homecoin:web-state', '{invalid')

    expect(await migrateLegacyLocalStorage(db)).toBe('already-current')
    expect((await repository.load())?.household.name).toBe('IndexedDB household')
  })

  it('rejects invalid legacy state when IndexedDB is empty', async () => {
    window.localStorage.setItem('homecoin:web-state', JSON.stringify({ schemaVersion: 1 }))
    expect(await migrateLegacyLocalStorage(db)).toBe('invalid')
    expect(await db.appState.count()).toBe(0)
  })

  it('restores a validated JSON backup through the active IndexedDB repository', async () => {
    const expected = createDemoState()
    const serialized = await serializeBackup(expected)
    const payload: unknown = JSON.parse(serialized)
    expect(isBackupPayload(payload)).toBe(true)
    if (!isBackupPayload(payload)) throw new Error('Expected a valid backup payload')
    expect(await validateBackupPayload(payload)).toBe(true)

    await repository.save(payload.state)
    expect((await repository.load())?.transactions.length).toBe(expected.transactions.length)
  })

  it('selects SQLite in Tauri and IndexedDB in the browser', () => {
    expect(createAppStateRepository()).toBeInstanceOf(WebIndexedDbAppStateRepository)
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    expect(createAppStateRepository()).toBeInstanceOf(TauriAppStateRepository)
  })

  it('publishes a visible error state when a critical save fails', async () => {
    const failing: AppStateRepository = {
      load: async () => null,
      save: async () => { throw new Error('disk full') },
      clear: async () => undefined,
      getMetadata: async () => ({ source: 'indexeddb', schemaVersion: null, updatedAt: null, migratedFromLocalStorage: false }),
    }
    setAppStateRepositoryForTests(failing)
    const statuses: string[] = []
    const unsubscribe = subscribePersistenceStatus((status) => statuses.push(status))

    await expect(saveState(createDemoState())).rejects.toThrow('disk full')
    expect(getPersistenceStatus()).toBe('error')
    expect(statuses).toContain('saving')
    expect(statuses).toContain('error')
    unsubscribe()
  })

  it('recovers the same data after an offline-style repository reload', async () => {
    const expected = createDemoState()
    await repository.save(expected)
    db.close()
    db = new HomeCoinWebDatabase(db.name)
    repository = new WebIndexedDbAppStateRepository(db)
    expect((await repository.load())?.household.id).toBe(expected.household.id)
  })
})
