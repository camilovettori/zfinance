import { createBackupPayload } from '@/domain/backup'
import { ensureCalculatedState } from '@/domain/calculations'
import type { AppState } from '@/domain/model'
import type { HomeCoinWebDatabase } from '@/persistence/web/db'
import { normalizeSyncEntityType, type RemoteEntity, type SyncConflict, type SyncEntityType, type SyncOperation, type SyncProvider } from './contracts'
import { applyRemoteEntity, diffSyncEntities, remoteEntityType, stateEntities } from './entities'
import { IndexedDbSyncQueue } from './queue'
import { publishSyncStatus } from './status'

const LINK_KEY = 'sync-link'
const CURSOR_KEY = 'sync-cursor'
const DEVICE_KEY = 'sync-device-id'

type StateAccess = {
  load(): Promise<AppState | null>
  save(state: AppState): Promise<AppState>
  changed?(state: AppState): void
}

type SyncLink = { householdId: string; ready: boolean; linkedAt: string }

export interface LocalMigrationSummary {
  counts: { accounts: number; categories: number; transactions: number; recurringRules: number }
  duplicateEntityKeys: string[]
  existingEntityKeys: string[]
  backupChecksum: string
  migrationId: string
}

const entityKey = (entityType: SyncEntityType, entityId: string) => `${entityType}:${entityId}`
const normalizedText = (value: unknown) => typeof value === 'string' ? value.trim().toLocaleLowerCase() : ''
const duplicateFingerprint = (entityType: SyncEntityType, payload: unknown) => {
  const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  if (entityType === 'transactions') return `${entityType}:${normalizedText(value.title)}:${value.amountCents ?? ''}:${value.transactionDate ?? ''}`
  if (entityType === 'recurring_rules') return `${entityType}:${normalizedText(value.name)}:${value.amountCents ?? ''}:${value.nextDueDate ?? ''}`
  if (entityType === 'financial_accounts' || entityType === 'categories') return `${entityType}:${normalizedText(value.name)}`
  return `${entityType}:${String(value.id ?? '')}`
}

export class SyncCoordinator {
  readonly queue: IndexedDbSyncQueue
  private running = false
  private unsubscribeRealtime: (() => void) | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private readonly db: HomeCoinWebDatabase
  private readonly provider: SyncProvider
  private readonly state: StateAccess
  private readonly householdId: string
  readonly deviceId: string
  private readonly maximumAttempts: number

  constructor(
    db: HomeCoinWebDatabase,
    provider: SyncProvider,
    state: StateAccess,
    householdId: string,
    deviceId: string,
    maximumAttempts = 5,
  ) {
    this.db = db
    this.provider = provider
    this.state = state
    this.householdId = householdId
    this.deviceId = deviceId
    this.maximumAttempts = maximumAttempts
    this.queue = new IndexedDbSyncQueue(db)
  }

  static async deviceId(db: HomeCoinWebDatabase) {
    const stored = await db.metadata.get(DEVICE_KEY)
    if (typeof stored?.value === 'string') return stored.value
    const value = crypto.randomUUID()
    const updatedAt = new Date().toISOString()
    await db.metadata.put({ key: DEVICE_KEY, value, updatedAt })
    return value
  }

  async link(ready = false) {
    const linkedAt = new Date().toISOString()
    const value: SyncLink = { householdId: this.householdId, ready, linkedAt }
    await this.db.metadata.put({ key: `${LINK_KEY}:${this.householdId}`, value, updatedAt: linkedAt })
  }

  async isReady() {
    const link = await this.db.metadata.get(`${LINK_KEY}:${this.householdId}`)
    const value = link?.value as Partial<SyncLink> | undefined
    return value?.householdId === this.householdId && value.ready === true
  }

  async enqueueStateChanges(previous: AppState, next: AppState) {
    if (!(await this.isReady()) || previous.household.id !== this.householdId) return []
    const createdAt = new Date().toISOString()
    const queued: SyncOperation[] = []
    for (const change of diffSyncEntities(previous, next)) {
      if (change.record.entityType === 'household_members') continue
      const metadata = await this.db.entitySyncMetadata.get(entityKey(change.record.entityType, change.record.entityId))
      const operation = await this.queue.enqueueCoalesced({
        id: crypto.randomUUID(), householdId: this.householdId, entityType: change.record.entityType,
        entityId: change.record.entityId, operation: change.operation, payload: change.record.payload,
        baseVersion: metadata?.version ?? 0, createdAt,
      })
      if (operation) queued.push(operation)
    }
    if (queued.length) publishSyncStatus({ status: navigator.onLine ? 'changes-waiting' : 'offline', message: navigator.onLine ? 'Changes waiting' : 'Offline', pending: queued.length })
    return queued
  }

  async prepareLocalMigration(local: AppState): Promise<LocalMigrationSummary> {
    const [backup, remote] = await Promise.all([createBackupPayload(local), this.provider.pull()])
    for (const change of remote.changes) await this.storeRemoteMetadata(change)
    const remoteIds = new Set(remote.changes.map((change) => entityKey(remoteEntityType(change), change.id)))
    const remoteFingerprints = new Set(remote.changes.map((change) => duplicateFingerprint(remoteEntityType(change), change.payload)))
    const localEntities = stateEntities(local).filter((record) => record.entityType !== 'household_members')
    const existingEntityKeys = localEntities.filter((record) => remoteIds.has(entityKey(record.entityType, record.entityId))).map((record) => entityKey(record.entityType, record.entityId))
    const duplicateEntityKeys = localEntities.filter((record) => {
      const key = entityKey(record.entityType, record.entityId)
      return !remoteIds.has(key) && remoteFingerprints.has(duplicateFingerprint(record.entityType, record.payload))
    }).map((record) => entityKey(record.entityType, record.entityId))
    const migrationId = crypto.randomUUID()
    const counts = {
      accounts: local.accounts.length,
      categories: local.categories.length,
      transactions: local.transactions.length,
      recurringRules: local.recurringRules.length,
    }
    await this.db.syncMigrations.put({
      id: migrationId, householdId: this.householdId, createdAt: new Date().toISOString(), counts,
      backupChecksum: backup.checksum, status: 'prepared',
    })
    return { counts, duplicateEntityKeys, existingEntityKeys, backupChecksum: backup.checksum, migrationId }
  }

  async uploadLocalState(local: AppState, summary: LocalMigrationSummary) {
    const duplicateSet = new Set(summary.duplicateEntityKeys)
    const existingSet = new Set(summary.existingEntityKeys)
    const createdAt = new Date().toISOString()
    for (const record of stateEntities(local)) {
      if (record.entityType === 'household_members') continue
      const key = entityKey(record.entityType, record.entityId)
      if (duplicateSet.has(key)) continue
      const metadata = await this.db.entitySyncMetadata.get(entityKey(record.entityType, record.entityId))
      await this.queue.enqueue({
        id: crypto.randomUUID(), householdId: this.householdId, entityType: record.entityType, entityId: record.entityId,
        operation: existingSet.has(key) ? 'update' : 'create', payload: record.payload,
        baseVersion: metadata?.version ?? (existingSet.has(key) ? 1 : 0), createdAt,
      })
    }
    await this.link(true)
    await this.db.syncMigrations.update(summary.migrationId, { status: 'queued' })
    await this.processQueue()
    const [pending, failed, conflicts] = await Promise.all([
      this.queue.list('pending'), this.queue.list('failed'), this.db.syncConflicts.where('status').equals('unresolved').count(),
    ])
    if (!pending.length && !failed.length && !conflicts) {
      await this.db.syncMigrations.update(summary.migrationId, { status: 'completed', completedAt: new Date().toISOString() })
    }
  }

  async processQueue() {
    if (this.running) return
    if (!navigator.onLine) {
      const pending = (await this.queue.list('pending')).length
      publishSyncStatus({ status: 'offline', message: 'Offline', pending })
      return
    }
    this.running = true
    try {
      const operations = await this.queue.ready()
      if (!operations.length) {
        const conflicts = await this.db.syncConflicts.where('status').equals('unresolved').count()
        publishSyncStatus({ status: conflicts ? 'conflict' : 'synced', message: conflicts ? 'Conflict' : 'Synced', pending: conflicts })
        return
      }
      publishSyncStatus({ status: 'syncing', message: 'Syncing', pending: operations.length })
      for (const operation of operations) await this.db.syncQueue.update(operation.id, { status: 'syncing' })
      const result = await this.provider.push(operations)
      for (const accepted of result.accepted) {
        const remote = accepted.remote
        const entityType = remoteEntityType(remote)
        await this.db.transaction('rw', this.db.syncQueue, this.db.entitySyncMetadata, async () => {
          await this.db.syncQueue.delete(accepted.operationId)
          const later = await this.db.syncQueue.where('entityId').equals(remote.id).toArray()
          for (const operation of later) {
            if (normalizeSyncEntityType(operation.entityType) === entityType && operation.status === 'pending') {
              await this.db.syncQueue.update(operation.id, { baseVersion: remote.version })
            }
          }
          await this.db.entitySyncMetadata.put({
            key: entityKey(entityType, remote.id), householdId: remote.householdId, entityType, entityId: remote.id,
            version: remote.version, status: 'synced', remoteUpdatedAt: remote.updatedAt,
            confirmedDeviceId: remote.deviceId, updatedAt: new Date().toISOString(),
          })
        })
      }
      for (const conflict of result.conflicts) {
        const operation = operations.find((item) => item.id === conflict.operationId)
        if (!operation) continue
        await this.recordConflict(operation, conflict.remote)
      }
      for (const failed of result.failed) await this.queue.retry(failed.operationId, failed.error, this.maximumAttempts)
      const failedCount = (await this.queue.list('failed')).length
      const conflictCount = await this.db.syncConflicts.where('status').equals('unresolved').count()
      const pending = (await this.queue.list('pending')).length
      publishSyncStatus({
        status: conflictCount ? 'conflict' : failedCount ? 'failed' : pending ? 'changes-waiting' : 'synced',
        message: conflictCount ? 'Conflict' : failedCount ? 'Failed' : pending ? 'Changes waiting' : 'Synced', pending: pending + failedCount + conflictCount,
      })
    } finally {
      this.running = false
      const pending = await this.queue.list('pending')
      const nextAttemptAt = pending.map((item) => item.nextAttemptAt).filter((value): value is string => Boolean(value)).sort()[0]
      if (nextAttemptAt) {
        if (this.retryTimer) clearTimeout(this.retryTimer)
        const delay = Math.max(0, new Date(nextAttemptAt).getTime() - Date.now())
        this.retryTimer = setTimeout(() => { void this.processQueue() }, delay)
      }
    }
  }

  async retryFailed() {
    const failed = await this.queue.list('failed')
    for (const operation of failed) {
      await this.db.syncQueue.update(operation.id, { status: 'pending', attempts: 0, lastError: undefined, nextAttemptAt: undefined })
    }
    await this.processQueue()
  }

  private async recordConflict(operation: SyncOperation, remote: RemoteEntity | null) {
    const existing = await this.db.syncConflicts.where('operationId').equals(operation.id).filter((item) => item.status === 'unresolved').first()
    if (existing) return
    const conflict: SyncConflict = {
      id: crypto.randomUUID(), operationId: operation.id, householdId: operation.householdId,
      entityType: normalizeSyncEntityType(operation.entityType), entityId: operation.entityId, localPayload: operation.payload,
      remote, createdAt: new Date().toISOString(), status: 'unresolved',
    }
    await this.db.transaction('rw', this.db.syncQueue, this.db.syncConflicts, async () => {
      await this.db.syncQueue.update(operation.id, { status: 'conflict', lastError: 'Remote version differs' })
      await this.db.syncConflicts.put(conflict)
    })
  }

  private async storeRemoteMetadata(remote: RemoteEntity) {
    const entityType = remoteEntityType(remote)
    await this.db.entitySyncMetadata.put({
      key: entityKey(entityType, remote.id), householdId: remote.householdId, entityType, entityId: remote.id,
      version: remote.version, status: 'synced', remoteUpdatedAt: remote.updatedAt,
      confirmedDeviceId: remote.deviceId, updatedAt: new Date().toISOString(),
    })
  }

  async pull() {
    const cursorKey = `${CURSOR_KEY}:${this.householdId}`
    const cursorRecord = await this.db.metadata.get(cursorKey)
    const cursor = typeof cursorRecord?.value === 'string' ? cursorRecord.value : undefined
    const result = await this.provider.pull(cursor)
    let local = await this.state.load()
    if (!local) return
    for (const remote of result.changes) {
      const entityType = remoteEntityType(remote)
      const pending = await this.queue.pendingForEntity(entityType, remote.id)
      if (pending.length) {
        const operation = pending[0]
        if (remote.version > operation.baseVersion) await this.recordConflict(operation, remote)
        continue
      }
      const metadata = await this.db.entitySyncMetadata.get(entityKey(entityType, remote.id))
      if (remote.deviceId === this.deviceId && metadata?.version === remote.version) continue
      local = applyRemoteEntity(local, remote)
      await this.storeRemoteMetadata(remote)
    }
    const saved = await this.state.save(ensureCalculatedState(local))
    this.state.changed?.(saved)
    if (result.cursor) await this.db.metadata.put({ key: cursorKey, value: result.cursor, updatedAt: new Date().toISOString() })
  }

  async startRealtime() {
    if (!this.provider.subscribe || this.unsubscribeRealtime) return
    this.unsubscribeRealtime = await this.provider.subscribe((event) => {
      const remote = event as RemoteEntity
      void this.applyRealtime(remote)
    })
  }

  private async applyRealtime(remote: RemoteEntity) {
    const entityType = remoteEntityType(remote)
    const metadata = await this.db.entitySyncMetadata.get(entityKey(entityType, remote.id))
    if (remote.deviceId === this.deviceId && metadata?.version === remote.version) return
    const pending = await this.queue.pendingForEntity(entityType, remote.id)
    if (pending.length) {
      if (remote.version > pending[0].baseVersion) await this.recordConflict(pending[0], remote)
      return
    }
    const local = await this.state.load()
    if (!local) return
    const saved = await this.state.save(ensureCalculatedState(applyRemoteEntity(local, remote)))
    await this.storeRemoteMetadata(remote)
    this.state.changed?.(saved)
  }

  async resolveConflict(id: string, choice: 'keep-mine' | 'use-remote' | 'cancel') {
    const conflict = await this.db.syncConflicts.get(id)
    if (!conflict || conflict.status !== 'unresolved') return
    if (choice === 'cancel') {
      await this.db.syncConflicts.update(id, { status: 'cancelled' })
      return
    }
    if (choice === 'keep-mine') {
      if (!conflict.remote) throw new Error('The remote item no longer exists. Use remote or cancel.')
      await this.db.syncQueue.delete(conflict.operationId)
      await this.queue.enqueue({
        id: crypto.randomUUID(), householdId: conflict.householdId, entityType: conflict.entityType,
        entityId: conflict.entityId, operation: 'update', payload: conflict.localPayload,
        baseVersion: conflict.remote.version, createdAt: new Date().toISOString(),
      })
      await this.db.syncConflicts.update(id, { status: 'keep-mine' })
      await this.processQueue()
      return
    }
    if (conflict.remote) {
      const local = await this.state.load()
      if (local) {
        const saved = await this.state.save(ensureCalculatedState(applyRemoteEntity(local, conflict.remote)))
        await this.storeRemoteMetadata(conflict.remote)
        this.state.changed?.(saved)
      }
    }
    await this.db.transaction('rw', this.db.syncQueue, this.db.syncConflicts, async () => {
      await this.db.syncQueue.delete(conflict.operationId)
      await this.db.syncConflicts.update(id, { status: 'use-remote' })
    })
  }

  stop() {
    this.unsubscribeRealtime?.()
    this.unsubscribeRealtime = null
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }
}
