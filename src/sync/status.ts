export type CloudSyncStatus = 'local-only' | 'connecting' | 'offline' | 'syncing' | 'synced' | 'changes-waiting' | 'failed' | 'error' | 'conflict'

export interface CloudSyncSnapshot {
  status: CloudSyncStatus
  message: string
  pending: number
}

let snapshot: CloudSyncSnapshot = { status: 'local-only', message: 'Local only', pending: 0 }
const listeners = new Set<(value: CloudSyncSnapshot) => void>()

export function publishSyncStatus(value: CloudSyncSnapshot) {
  if (snapshot.status === value.status && snapshot.message === value.message && snapshot.pending === value.pending) return
  snapshot = value
  listeners.forEach((listener) => listener(value))
}

export const getSyncStatus = () => snapshot
export const subscribeSyncStatus = (listener: (value: CloudSyncSnapshot) => void) => {
  listeners.add(listener)
  listener(snapshot)
  return () => { listeners.delete(listener) }
}
