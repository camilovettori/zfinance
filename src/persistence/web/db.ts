import Dexie, { type EntityTable } from 'dexie'
import type { AppState } from '@/domain/model'
import type { SyncConflict, SyncEntityType, SyncOperation, SyncStatus } from '@/sync/contracts'

export type AppStateRecord = {
  id: string
  schemaVersion: number
  payload: AppState
  updatedAt: string
}

export type PersistenceMetadataRecord = {
  key: string
  value: unknown
  updatedAt: string
}

export type MigrationStateRecord = {
  key: string
  completedAt: string
  source: string
}

export type EntitySyncMetadataRecord = {
  key: string
  householdId: string
  entityType: SyncEntityType
  entityId: string
  version: number
  status: SyncStatus
  remoteUpdatedAt?: string
  confirmedDeviceId?: string | null
  updatedAt: string
}

export type SyncMigrationRecord = {
  id: string
  householdId: string
  createdAt: string
  completedAt?: string
  counts: Record<string, number>
  backupChecksum: string
  status: 'prepared' | 'queued' | 'completed' | 'cancelled' | 'failed'
}

export class HomeCoinWebDatabase extends Dexie {
  appState!: EntityTable<AppStateRecord, 'id'>
  syncQueue!: EntityTable<SyncOperation, 'id'>
  metadata!: EntityTable<PersistenceMetadataRecord, 'key'>
  migrationState!: EntityTable<MigrationStateRecord, 'key'>
  entitySyncMetadata!: EntityTable<EntitySyncMetadataRecord, 'key'>
  syncConflicts!: EntityTable<SyncConflict, 'id'>
  syncMigrations!: EntityTable<SyncMigrationRecord, 'id'>

  constructor(name = 'homecoin-local') {
    super(name)
    this.version(1).stores({
      appState: 'id, updatedAt, schemaVersion',
      syncQueue: 'id, householdId, status, createdAt, [status+createdAt]',
      metadata: 'key, updatedAt',
      migrationState: 'key, completedAt',
    })
    this.version(2).stores({
      appState: 'id, updatedAt, schemaVersion',
      syncQueue: 'id, householdId, entityType, entityId, status, createdAt, nextAttemptAt, [status+createdAt]',
      metadata: 'key, updatedAt',
      migrationState: 'key, completedAt',
      entitySyncMetadata: 'key, householdId, entityType, entityId, status, updatedAt, [householdId+entityType]',
      syncConflicts: 'id, operationId, householdId, entityType, entityId, status, createdAt',
      syncMigrations: 'id, householdId, status, createdAt',
    })
    this.version(3).stores({
      appState: 'id, updatedAt, schemaVersion',
      syncQueue: 'id, householdId, entityType, entityId, status, createdAt, nextAttemptAt, [status+createdAt]',
      metadata: 'key, updatedAt',
      migrationState: 'key, completedAt',
      entitySyncMetadata: 'key, householdId, entityType, entityId, status, updatedAt, [householdId+entityType]',
      syncConflicts: 'id, operationId, householdId, entityType, entityId, status, createdAt',
      syncMigrations: 'id, householdId, status, createdAt',
    })
  }
}

export let webDatabase = new HomeCoinWebDatabase()

export async function recreateWebDatabase() {
  const previous = webDatabase
  previous.close()
  await previous.delete()
  webDatabase = new HomeCoinWebDatabase()
}
