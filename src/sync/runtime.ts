import type { AppState } from '@/domain/model'
import { loadState, saveState } from '@/services/storage'
import { webDatabase } from '@/persistence/web/db'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SyncCoordinator } from './coordinator'
import { SupabaseSyncProvider } from './supabase-provider'

let coordinator: SyncCoordinator | null = null
let stateListener: ((state: AppState) => void) | null = null
let onlineHandler: (() => void) | null = null

export const registerSyncedStateListener = (listener: ((state: AppState) => void) | null) => {
  stateListener = listener
}

export async function activateSyncRuntime(client: SupabaseClient, householdId: string) {
  coordinator?.stop()
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
  await coordinator.link(await coordinator.isReady())
  if (await coordinator.isReady()) {
    await coordinator.processQueue()
    await coordinator.pull()
    await coordinator.startRealtime()
  }
  return coordinator
}

export function activeSyncCoordinator() {
  return coordinator
}

export async function enqueueSyncChanges(previous: AppState, next: AppState) {
  const queued = await coordinator?.enqueueStateChanges(previous, next) ?? []
  if (queued.length && navigator.onLine) void coordinator?.processQueue()
}

export function deactivateSyncRuntime() {
  coordinator?.stop()
  coordinator = null
  if (onlineHandler) window.removeEventListener('online', onlineHandler)
  onlineHandler = null
}
