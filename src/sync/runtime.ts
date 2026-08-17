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
let activeHouseholdId: string | null = null
let activationQueue: Promise<void> = Promise.resolve()
let activeSyncPromise: Promise<void> | null = null
let activeSyncTarget: SyncCoordinator | null = null
let periodicTimer: ReturnType<typeof setInterval> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryAttempt = 0
let onlineHandler: (() => void) | null = null
let focusHandler: (() => void) | null = null
let visibilityHandler: (() => void) | null = null
let pendingRecovery: (() => void) | null = null

const automaticSync = (reason: string) => {
  void syncNow().catch((error) => console.error(`Automatic sync failed (${reason}); retry scheduled.`, error))
}

function scheduleRetry(action: () => void) {
  pendingRecovery = action
  if (!navigator.onLine) return
  const delay = Math.min(30_000, 1_000 * 2 ** retryAttempt)
  retryAttempt += 1
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    retryTimer = null
    if (pendingRecovery === action) pendingRecovery = null
    action()
  }, delay)
}

function stopAutomaticSync() {
  if (periodicTimer) clearInterval(periodicTimer)
  if (retryTimer) clearTimeout(retryTimer)
  if (onlineHandler) window.removeEventListener('online', onlineHandler)
  if (focusHandler) window.removeEventListener('focus', focusHandler)
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler)
  periodicTimer = null
  retryTimer = null
  onlineHandler = null
  focusHandler = null
  visibilityHandler = null
  pendingRecovery = null
}

function startAutomaticSync() {
  stopAutomaticSync()
  periodicTimer = setInterval(() => automaticSync('interval'), 60_000)
  onlineHandler = () => {
    if (pendingRecovery) {
      const recover = pendingRecovery
      pendingRecovery = null
      recover()
    } else {
      automaticSync('online')
    }
  }
  focusHandler = () => automaticSync('focus')
  visibilityHandler = () => {
    if (document.visibilityState === 'visible') automaticSync('visibility')
  }
  window.addEventListener('online', onlineHandler)
  window.addEventListener('focus', focusHandler)
  document.addEventListener('visibilitychange', visibilityHandler)
}

export function syncNow() {
  const target = coordinator
  if (!target) return Promise.resolve()
  if (activeSyncPromise && activeSyncTarget === target) {
    void target.syncNow()
    return activeSyncPromise
  }
  const sync = target.syncNow()
    .then(() => {
      if (coordinator !== target) return
      retryAttempt = 0
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
      pendingRecovery = null
    })
    .catch((error) => {
      if (coordinator === target && navigator.onLine) {
        scheduleRetry(() => automaticSync('retry'))
      }
      throw error
    })
    .finally(() => {
      if (activeSyncPromise === sync) {
        activeSyncPromise = null
        activeSyncTarget = null
      }
    })
  activeSyncPromise = sync
  activeSyncTarget = target
  return sync
}

export const registerSyncedStateListener = (listener: ((state: AppState) => void) | null) => {
  stateListener = listener
}

type ActivateSyncRuntimeOptions = { openRemoteIfNeeded?: boolean }

async function activateSyncRuntimeNow(client: SupabaseClient, householdId: string, options: ActivateSyncRuntimeOptions) {
  if (coordinator && activeHouseholdId === householdId) {
    if (await coordinator.isReady()) {
      await syncNow()
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
  startAutomaticSync()
  const [ready, snapshot] = await Promise.all([coordinator.isReady(), loadHouseholdState(householdId)])
  try {
    if (ready && snapshot) {
      const activated = await activateHouseholdState(householdId)
      if (activated) stateListener?.(activated)
      await syncNow()
    } else if (options.openRemoteIfNeeded) {
      const opened = await coordinator.openRemoteHousehold(await loadState() ?? undefined)
      if (opened) await coordinator.startRealtime()
      else await coordinator.link(false)
    } else {
      await coordinator.link(false)
    }
  } catch (error) {
    publishSyncStatus({ status: 'error', message: 'Sync error', pending: 0 })
    scheduleRetry(() => {
      void activateSyncRuntime(client, householdId, options)
        .catch((caught) => console.error('Automatic sync activation retry failed; retry scheduled.', caught))
    })
    throw error
  }
  retryAttempt = 0
  pendingRecovery = null
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
    if (!coordinator) {
      scheduleRetry(() => {
        void restoreActiveSyncRuntime(client)
          .catch((caught) => console.error('Automatic sync restore retry failed; retry scheduled.', caught))
      })
    }
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
  if (queued.length && navigator.onLine) automaticSync('local change')
}

export function deactivateSyncRuntime() {
  stopAutomaticSync()
  coordinator?.stop()
  coordinator = null
  activeSyncPromise = null
  activeSyncTarget = null
  activeHouseholdId = null
  retryAttempt = 0
  pendingRecovery = null
  publishSyncStatus({ status: 'local-only', message: 'Local only', pending: 0 })
}
