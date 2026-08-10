import type { AppState } from '@/domain/model'
import {
  activateHouseholdState,
  getActiveHouseholdId,
  loadHouseholdState,
  loadState,
  saveState,
  setActiveHouseholdId,
} from '@/services/storage'
import { webDatabase } from '@/persistence/web/db'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SyncCoordinator } from './coordinator'
import { SupabaseHouseholdRepository, type HouseholdSummary } from './repositories'
import { publishSyncStatus } from './status'
import { SupabaseSyncProvider } from './supabase-provider'

let coordinator: SyncCoordinator | null = null
let stateListener: ((state: AppState) => void) | null = null
let onlineHandler: (() => void) | null = null
let activeHouseholdId: string | null = null
let activationQueue: Promise<void> = Promise.resolve()

export const registerSyncedStateListener = (listener: ((state: AppState) => void) | null) => {
  stateListener = listener
}

type ActivateSyncRuntimeOptions = { openRemoteIfNeeded?: boolean }

async function activateSyncRuntimeNow(client: SupabaseClient, householdId: string, options: ActivateSyncRuntimeOptions) {
  if (coordinator && activeHouseholdId === householdId) {
    if (await coordinator.isReady()) {
      await coordinator.processQueue()
      await coordinator.pull()
      await coordinator.startRealtime()
      return coordinator
    }
    if (!options.openRemoteIfNeeded) return coordinator
  }
  coordinator?.stop()
  activeHouseholdId = householdId
  await setActiveHouseholdId(householdId)
  const deviceId = await SyncCoordinator.deviceId(webDatabase)
  coordinator = new SyncCoordinator(
    webDatabase,
    new SupabaseSyncProvider(client, householdId, deviceId),
    { load: loadState, save: saveState, changed: (state) => stateListener?.(state) },
    householdId,
    deviceId,
  )
  if (onlineHandler) window.removeEventListener('online', onlineHandler)
  onlineHandler = () => {
    void coordinator?.processQueue().then(() => coordinator?.pull())
  }
  window.addEventListener('online', onlineHandler)
  const [ready, snapshot] = await Promise.all([coordinator.isReady(), loadHouseholdState(householdId)])
  try {
    if (ready && snapshot) {
      const activated = await activateHouseholdState(householdId)
      if (activated) stateListener?.(activated)
      await coordinator.processQueue()
      await coordinator.pull()
      await coordinator.startRealtime()
    } else if (options.openRemoteIfNeeded) {
      const opened = await coordinator.openRemoteHousehold(await loadState() ?? undefined)
      if (opened) await coordinator.startRealtime()
      else await coordinator.link(false)
    } else {
      await coordinator.link(false)
    }
  } catch (error) {
    publishSyncStatus({ status: 'error', message: 'Sync error', pending: 0 })
    throw error
  }
  return coordinator
}

export function activateSyncRuntime(client: SupabaseClient, householdId: string, options: ActivateSyncRuntimeOptions = {}) {
  const activation = activationQueue.then(() => activateSyncRuntimeNow(client, householdId, options))
  activationQueue = activation.then(() => undefined, () => undefined)
  return activation
}

export async function restoreActiveSyncRuntime(client: SupabaseClient): Promise<HouseholdSummary | null> {
  publishSyncStatus({ status: 'connecting', message: 'Connecting', pending: 0 })
  try {
    const households = await new SupabaseHouseholdRepository(client).list()
    if (!households.length) {
      deactivateSyncRuntime()
      return null
    }
    const persistedId = await getActiveHouseholdId()
    const selected = households.find((item) => item.household.id === persistedId) ?? households[0]
    await activateSyncRuntime(client, selected.household.id, { openRemoteIfNeeded: true })
    return selected
  } catch (error) {
    publishSyncStatus({ status: 'error', message: 'Sync error', pending: 0 })
    throw error
  }
}

export function activeSyncCoordinator() {
  return coordinator
}

export function activeSyncHouseholdId() {
  return activeHouseholdId
}

export async function enqueueSyncChanges(previous: AppState, next: AppState) {
  const queued = await coordinator?.enqueueStateChanges(previous, next) ?? []
  if (queued.length && navigator.onLine) void coordinator?.processQueue()
}

export function deactivateSyncRuntime() {
  coordinator?.stop()
  coordinator = null
  activeHouseholdId = null
  if (onlineHandler) window.removeEventListener('online', onlineHandler)
  onlineHandler = null
  publishSyncStatus({ status: 'local-only', message: 'Local only', pending: 0 })
}
