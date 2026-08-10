import type { HomeCoinWebDatabase } from '@/persistence/web/db'
import type { SyncOperation, SyncStatus } from './contracts'

export class IndexedDbSyncQueue {
  private readonly db: HomeCoinWebDatabase

  constructor(db: HomeCoinWebDatabase) {
    this.db = db
  }

  async enqueue(operation: Omit<SyncOperation, 'status' | 'attempts'> & Partial<Pick<SyncOperation, 'status' | 'attempts'>>) {
    const queued: SyncOperation = { ...operation, status: operation.status ?? 'pending', attempts: operation.attempts ?? 0 }
    await this.db.syncQueue.put(queued)
    return queued
  }

  async enqueueCoalesced(operation: Omit<SyncOperation, 'status' | 'attempts'>) {
    const existing = (await this.pendingForEntity(operation.entityType, operation.entityId))
      .find((item) => item.status === 'pending' || item.status === 'failed')
    if (!existing) return this.enqueue(operation)
    if (existing.operation === 'create' && operation.operation === 'delete') {
      await this.remove(existing.id)
      return null
    }
    const nextOperation = existing.operation === 'create' ? 'create' : operation.operation
    const queued: SyncOperation = {
      ...existing,
      operation: nextOperation,
      payload: operation.payload,
      createdAt: operation.createdAt,
      status: 'pending',
      attempts: existing.status === 'failed' ? 0 : existing.attempts,
      lastError: undefined,
      nextAttemptAt: undefined,
    }
    await this.db.syncQueue.put(queued)
    return queued
  }

  async list(status?: SyncStatus) {
    return status ? this.db.syncQueue.where('status').equals(status).sortBy('createdAt') : this.db.syncQueue.orderBy('createdAt').toArray()
  }

  async ready(now = new Date()) {
    const pending = await this.list('pending')
    return pending.filter((operation) => !operation.nextAttemptAt || operation.nextAttemptAt <= now.toISOString())
  }

  async mark(id: string, status: SyncStatus, lastError?: string) {
    const current = await this.db.syncQueue.get(id)
    if (!current) return
    await this.db.syncQueue.put({
      ...current,
      status,
      attempts: status === 'syncing' || status === 'failed' ? current.attempts + 1 : current.attempts,
      lastError,
    })
  }


  async retry(id: string, error: string, maximumAttempts: number, now = new Date()) {
    const current = await this.db.syncQueue.get(id)
    if (!current) return
    const attempts = current.attempts + 1
    const failed = attempts >= maximumAttempts
    const delayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1))
    await this.db.syncQueue.put({
      ...current,
      attempts,
      status: failed ? 'failed' : 'pending',
      lastError: error,
      nextAttemptAt: failed ? undefined : new Date(now.getTime() + delayMs).toISOString(),
    })
  }

  async pendingForEntity(entityType: SyncOperation['entityType'], entityId: string) {
    return (await this.db.syncQueue.where('entityId').equals(entityId).toArray())
      .filter((operation) => operation.entityType === entityType && ['pending', 'syncing', 'conflict', 'failed'].includes(operation.status))
  }

  async remove(id: string) {
    await this.db.syncQueue.delete(id)
  }
}
