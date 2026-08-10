export type SyncStatus = 'synced' | 'pending' | 'syncing' | 'conflict' | 'failed'
export type SyncEntityOperation = 'create' | 'update' | 'delete'
export type SyncEntityType =
  | 'households'
  | 'household_members'
  | 'financial_accounts'
  | 'categories'
  | 'transactions'
  | 'recurring_rules'
  | 'settings'
export type SyncOperationEntityType = SyncEntityType | 'transaction'

export const normalizeSyncEntityType = (value: SyncOperationEntityType): SyncEntityType =>
  value === 'transaction' ? 'transactions' : value

export interface SyncOperation {
  id: string
  householdId: string
  entityType: SyncOperationEntityType
  entityId: string
  operation: SyncEntityOperation
  payload: unknown
  baseVersion: number
  createdAt: string
  attempts: number
  status: SyncStatus
  lastError?: string
  nextAttemptAt?: string
}

export interface RemoteEntity<T = unknown> {
  entityType: SyncEntityType
  id: string
  householdId: string
  payload: T
  createdAt: string
  updatedAt: string
  createdBy: string
  updatedBy: string
  version: number
  deletedAt: string | null
  clientUpdatedAt: string
  deviceId?: string | null
}

export interface SyncConflict {
  id: string
  operationId: string
  householdId: string
  entityType: SyncEntityType
  entityId: string
  localPayload: unknown
  remote: RemoteEntity | null
  createdAt: string
  status: 'unresolved' | 'keep-mine' | 'use-remote' | 'cancelled'
}

export interface SyncPushResult {
  acceptedIds: string[]
  accepted: Array<{ operationId: string; remote: RemoteEntity }>
  conflicts: Array<{ operationId: string; remote: RemoteEntity | null }>
  failed: Array<{ operationId: string; error: string }>
}

export interface SyncPullResult {
  cursor?: string
  changes: RemoteEntity[]
}

export type SyncEventHandler = (event: unknown) => void
export type Unsubscribe = () => void

export interface SyncProvider {
  push(operations: SyncOperation[]): Promise<SyncPushResult>
  pull(cursor?: string): Promise<SyncPullResult>
  subscribe?(handler: SyncEventHandler): Promise<Unsubscribe>
}
