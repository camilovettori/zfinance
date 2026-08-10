import type { AppState, AuditEvent, BackupRecord, ForecastSnapshot } from '@/domain/model'
import {
  getAppStateRepository,
  isTauriRuntime,
  TauriAppStateRepository,
  type PersistenceStatus,
} from '@/persistence'

type StatusListener = (status: PersistenceStatus) => void
let persistenceStatus: PersistenceStatus = 'loading'
const listeners = new Set<StatusListener>()

const publish = (status: PersistenceStatus) => {
  persistenceStatus = status
  listeners.forEach((listener) => listener(status))
}

export const subscribePersistenceStatus = (listener: StatusListener) => {
  listeners.add(listener)
  listener(persistenceStatus)
  return () => {
    listeners.delete(listener)
  }
}

export const getPersistenceStatus = () => persistenceStatus

export async function ensureStorage() {
  const repository = getAppStateRepository()
  if (repository instanceof TauriAppStateRepository) await repository.ensure()
}

export async function loadState(): Promise<AppState | null> {
  publish('loading')
  try {
    const state = await getAppStateRepository().load()
    publish('saved')
    return state
  } catch (error) {
    publish('error')
    throw error
  }
}

export async function saveState(state: AppState) {
  publish('saving')
  try {
    const saved = await getAppStateRepository().save(state)
    publish('saved')
    return saved
  } catch (error) {
    publish('error')
    throw error
  }
}

const desktopRepository = () => {
  const repository = getAppStateRepository()
  return repository instanceof TauriAppStateRepository ? repository : null
}

export async function appendAuditEvent(event: AuditEvent) {
  await desktopRepository()?.appendAuditEvent(event)
}

export async function recordBackup(record: BackupRecord) {
  await desktopRepository()?.recordBackup(record)
}

export async function recordForecastSnapshot(snapshot: ForecastSnapshot) {
  await desktopRepository()?.recordForecastSnapshot(snapshot)
}

export async function updateSetting(key: string, value: unknown) {
  await desktopRepository()?.updateSetting(key, value)
}

export async function readSetting<T>(key: string): Promise<T | null> {
  return await desktopRepository()?.readSetting<T>(key) ?? null
}

export { isTauriRuntime }
