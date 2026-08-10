import { normalizeSyncEntityType } from './contracts'
import type { RemoteEntity, SyncOperation, SyncProvider, SyncPullResult, SyncPushResult } from './contracts'

export class DisabledSyncProvider implements SyncProvider {
  async push(operations: SyncOperation[]): Promise<SyncPushResult> {
    return {
      acceptedIds: [],
      accepted: [],
      conflicts: [],
      failed: operations.map((operation) => ({ operationId: operation.id, error: 'Sync is disabled' })),
    }
  }

  async pull(): Promise<SyncPullResult> {
    return { changes: [] }
  }
}

export class MockSyncProvider implements SyncProvider {
  readonly pushed: SyncOperation[] = []
  readonly pulledChanges: RemoteEntity[] = []

  async push(operations: SyncOperation[]): Promise<SyncPushResult> {
    this.pushed.push(...structuredClone(operations))
    return {
      acceptedIds: operations.map((operation) => operation.id),
      accepted: operations.map((operation) => ({
        operationId: operation.id,
        remote: {
          entityType: normalizeSyncEntityType(operation.entityType),
          id: operation.entityId,
          householdId: operation.householdId,
          payload: structuredClone(operation.payload),
          createdAt: operation.createdAt,
          updatedAt: operation.createdAt,
          createdBy: 'mock-user',
          updatedBy: 'mock-user',
          version: operation.baseVersion + 1,
          deletedAt: operation.operation === 'delete' ? operation.createdAt : null,
          clientUpdatedAt: operation.createdAt,
        },
      })),
      conflicts: [],
      failed: [],
    }
  }

  async pull(cursor?: string): Promise<SyncPullResult> {
    return { cursor, changes: structuredClone(this.pulledChanges) }
  }
}

export const syncEnabled = import.meta.env.VITE_SYNC_ENABLED === 'true'
export const createSyncProvider = (): SyncProvider => new DisabledSyncProvider()
