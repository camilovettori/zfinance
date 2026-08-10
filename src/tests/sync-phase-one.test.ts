import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureCalculatedState } from '@/domain/calculations'
import type { AppState } from '@/domain/model'
import { createDemoState } from '@/domain/seed'
import { HomeCoinWebDatabase } from '@/persistence'
import { waitFor } from '@testing-library/react'
import {
  applyRemoteEntity,
  SyncCoordinator,
  type RemoteEntity,
  type SyncEntityType,
  type SyncEventHandler,
  type SyncOperation,
  type SyncProvider,
  type SyncPushResult,
} from '@/sync'

type TypedRemote = RemoteEntity & { entityType: SyncEntityType }

const remote = (entityType: SyncEntityType, payload: unknown, version = 1, deletedAt: string | null = null): TypedRemote => {
  const value = payload as { id?: string; householdId?: string }
  const now = '2026-08-06T12:00:00.000Z'
  return {
    entityType, id: value.id ?? crypto.randomUUID(), householdId: value.householdId ?? value.id ?? crypto.randomUUID(), payload,
    createdAt: now, updatedAt: now, createdBy: 'user-a', updatedBy: 'user-a', version, deletedAt, clientUpdatedAt: now, deviceId: 'remote-device',
  }
}

class MemoryProvider implements SyncProvider {
  rows = new Map<string, TypedRemote>()
  failCount = 0
  pushCount = 0
  pullCount = 0
  pullError: Error | null = null
  handler: SyncEventHandler | null = null

  async push(operations: SyncOperation[]): Promise<SyncPushResult> {
    this.pushCount += 1
    const result: SyncPushResult = { acceptedIds: [], accepted: [], conflicts: [], failed: [] }
    for (const operation of operations) {
      if (this.failCount > 0) {
        this.failCount -= 1
        result.failed.push({ operationId: operation.id, error: 'offline' })
        continue
      }
      const entityType = operation.entityType === 'transaction' ? 'transactions' : operation.entityType
      const key = `${entityType}:${operation.entityId}`
      const old = this.rows.get(key)
      if (operation.operation !== 'create' && (!old || old.version !== operation.baseVersion)) {
        result.conflicts.push({ operationId: operation.id, remote: old ?? null })
        continue
      }
      const accepted = remote(entityType, operation.payload, (old?.version ?? 0) + 1, operation.operation === 'delete' ? new Date().toISOString() : null)
      accepted.id = operation.entityId
      accepted.householdId = operation.householdId
      this.rows.set(key, accepted)
      result.acceptedIds.push(operation.id)
      result.accepted.push({ operationId: operation.id, remote: accepted })
    }
    return result
  }

  async pull(cursor?: string) {
    this.pullCount += 1
    if (this.pullError) throw this.pullError
    return { cursor: cursor ?? new Date().toISOString(), changes: [...this.rows.values()] }
  }
  async subscribe(handler: SyncEventHandler) { this.handler = handler; return () => { this.handler = null } }
  emit(value: TypedRemote) { this.handler?.(value) }
}

let db: HomeCoinWebDatabase
let provider: MemoryProvider
let value: AppState
let coordinator: SyncCoordinator

beforeEach(async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  db = new HomeCoinWebDatabase(`homecoin-phase-one-${crypto.randomUUID()}`)
  provider = new MemoryProvider()
  value = ensureCalculatedState(createDemoState())
  coordinator = new SyncCoordinator(db, provider, {
    load: async () => value,
    save: async (next) => { value = next; return next },
    changed: (next) => { value = next },
  }, value.household.id, 'local-device', 3)
  await coordinator.link(true)
})

afterEach(async () => {
  coordinator.stop(); db.close(); await db.delete()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
})

describe('local-first queue and optimistic versions', () => {
  it('saves a create locally before it is queued and pushed', async () => {
    const previous = structuredClone(value)
    value.transactions.push({ ...value.transactions[0], id: crypto.randomUUID(), title: 'Local first', amountCents: 3799, transactionDate: '2026-08-13', dueDate: '2026-08-13' })
    await coordinator.enqueueStateChanges(previous, value)
    expect(value.transactions.some((item) => item.title === 'Local first')).toBe(true)
    expect((await coordinator.queue.list('pending')).some((item) => item.payload && (item.payload as { amountCents?: number }).amountCents === 3799)).toBe(true)
    await coordinator.processQueue()
    expect(await coordinator.queue.list()).toEqual([])
  })

  it('coalesces repeated offline edits for one entity without creating self-conflicts', async () => {
    const item = value.transactions[0]
    await coordinator.queue.enqueueCoalesced({ id: crypto.randomUUID(), householdId: value.household.id, entityType: 'transactions', entityId: item.id, operation: 'update', payload: { ...item, title: 'First' }, baseVersion: 3, createdAt: '2026-08-06T12:00:00.000Z' })
    await coordinator.queue.enqueueCoalesced({ id: crypto.randomUUID(), householdId: value.household.id, entityType: 'transactions', entityId: item.id, operation: 'update', payload: { ...item, title: 'Latest' }, baseVersion: 3, createdAt: '2026-08-06T12:00:01.000Z' })
    const pending = await coordinator.queue.list('pending')
    expect(pending).toHaveLength(1)
    expect((pending[0].payload as { title: string }).title).toBe('Latest')
  })

  it('keeps an offline update pending and retries after reconnection with bounded attempts', async () => {
    const previous = structuredClone(value)
    const original = value.transactions[0]
    provider.rows.set(`transactions:${original.id}`, remote('transactions', original, 1))
    await db.entitySyncMetadata.put({
      key: `transactions:${original.id}`, householdId: value.household.id, entityType: 'transactions', entityId: original.id,
      version: 1, status: 'synced', updatedAt: new Date().toISOString(),
    })
    value.transactions[0] = { ...value.transactions[0], title: 'Offline edit' }
    await coordinator.enqueueStateChanges(previous, value)
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await coordinator.processQueue()
    expect((await coordinator.queue.list('pending')).length).toBeGreaterThan(0)
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    await coordinator.processQueue()
    expect(await coordinator.queue.list()).toEqual([])
  })

  it('marks a stale base version as conflict and Keep mine retries against remote version', async () => {
    const item = value.transactions[0]
    const server = remote('transactions', { ...item, title: 'Remote' }, 2)
    provider.rows.set(`transactions:${item.id}`, server)
    await coordinator.queue.enqueue({ id: crypto.randomUUID(), householdId: value.household.id, entityType: 'transactions', entityId: item.id, operation: 'update', payload: { ...item, title: 'Mine' }, baseVersion: 1, createdAt: new Date().toISOString() })
    await coordinator.processQueue()
    const conflict = (await db.syncConflicts.where('status').equals('unresolved').toArray())[0]
    expect(conflict.remote?.version).toBe(2)
    await coordinator.resolveConflict(conflict.id, 'keep-mine')
    expect((provider.rows.get(`transactions:${item.id}`)?.payload as { title: string }).title).toBe('Mine')
  })

  it('Use remote replaces the local entity but never auto-merges amount/date/status', async () => {
    const item = value.transactions[0]
    const serverPayload = { ...item, title: 'Server', amountCents: 9901, transactionDate: '2026-09-01', status: 'paid' as const }
    const server = remote('transactions', serverPayload, 4)
    provider.rows.set(`transactions:${item.id}`, server)
    await coordinator.queue.enqueue({ id: crypto.randomUUID(), householdId: value.household.id, entityType: 'transactions', entityId: item.id, operation: 'update', payload: { ...item, amountCents: 100 }, baseVersion: 3, createdAt: new Date().toISOString() })
    await coordinator.processQueue()
    const conflict = (await db.syncConflicts.where('status').equals('unresolved').toArray())[0]
    await coordinator.resolveConflict(conflict.id, 'use-remote')
    expect(value.transactions.find((entry) => entry.id === item.id)).toMatchObject({ amountCents: 9901, transactionDate: '2026-09-01', status: 'paid' })
  })

  it('soft delete confirms a tombstone instead of issuing a physical delete', async () => {
    const item = value.transactions[0]
    provider.rows.set(`transactions:${item.id}`, remote('transactions', item, 1))
    await coordinator.queue.enqueue({ id: crypto.randomUUID(), householdId: value.household.id, entityType: 'transactions', entityId: item.id, operation: 'delete', payload: item, baseVersion: 1, createdAt: new Date().toISOString() })
    await coordinator.processQueue()
    expect(provider.rows.get(`transactions:${item.id}`)?.deletedAt).not.toBeNull()
  })

  it('stops retrying and marks failed after the configured maximum', async () => {
    const item = value.transactions[0]
    provider.failCount = 3
    const operation = await coordinator.queue.enqueue({ id: crypto.randomUUID(), householdId: value.household.id, entityType: 'transactions', entityId: item.id, operation: 'create', payload: item, baseVersion: 0, createdAt: new Date().toISOString() })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await coordinator.processQueue()
      await db.syncQueue.update(operation.id, { nextAttemptAt: undefined })
    }
    expect((await coordinator.queue.list('failed'))[0]).toMatchObject({ attempts: 3, lastError: 'offline' })
  })

  it('prepares explicit migration with backup checksum, counts, and duplicate detection', async () => {
    const account = value.accounts[0]
    provider.rows.set(`financial_accounts:${crypto.randomUUID()}`, remote('financial_accounts', { ...account, id: crypto.randomUUID() }, 1))
    const summary = await coordinator.prepareLocalMigration(value)
    expect(summary.counts).toEqual(expect.objectContaining({ accounts: value.accounts.length, transactions: value.transactions.length }))
    expect(summary.backupChecksum).toMatch(/^[a-f0-9]{64}$/)
    expect(summary.duplicateEntityKeys).toContain(`financial_accounts:${account.id}`)
    expect(await db.syncMigrations.get(summary.migrationId)).toMatchObject({ status: 'prepared' })
  })

  it('treats the current remote household as existing and still uploads settings with the same UUID', async () => {
    const householdKey = `households:${value.household.id}`
    const settingsKey = `settings:${value.household.id}`
    provider.rows.set(householdKey, remote('households', value.household, 1))

    const summary = await coordinator.prepareLocalMigration(value)

    expect(summary.existingEntityKeys).toContain(householdKey)
    expect(summary.duplicateEntityKeys).not.toContain(householdKey)
    expect(summary.duplicateEntityKeys).toHaveLength(0)

    await coordinator.uploadLocalState(value, summary)

    expect(provider.rows.get(householdKey)?.version).toBe(2)
    expect(provider.rows.get(settingsKey)?.entityType).toBe('settings')
  })

  it('does not skip another entity type that uses the UUID of a real duplicate', async () => {
    const sharedId = crypto.randomUUID()
    value.transactions[0] = { ...value.transactions[0], id: sharedId }
    value.categories[0] = { ...value.categories[0], id: sharedId }
    const remoteTransaction = { ...value.transactions[0], id: crypto.randomUUID() }
    provider.rows.set(`transactions:${remoteTransaction.id}`, remote('transactions', remoteTransaction, 1))

    const summary = await coordinator.prepareLocalMigration(value)

    expect(summary.duplicateEntityKeys).toContain(`transactions:${sharedId}`)
    expect(summary.duplicateEntityKeys).not.toContain(`categories:${sharedId}`)

    await coordinator.uploadLocalState(value, summary)

    expect(provider.rows.has(`transactions:${sharedId}`)).toBe(false)
    expect(provider.rows.get(`categories:${sharedId}`)?.entityType).toBe('categories')
  })
})

describe('pull and Realtime reconciliation', () => {
  it('opens a populated remote household on a new origin without uploading and notifies React', async () => {
    const remoteHouseholdId = crypto.randomUUID()
    const remoteHousehold = { ...value.household, id: remoteHouseholdId, name: 'Remote household' }
    const remoteAccount = { ...value.accounts[0], id: crypto.randomUUID(), householdId: remoteHouseholdId, name: 'Remote account' }
    provider.rows.set(`households:${remoteHouseholdId}`, remote('households', remoteHousehold, 1))
    provider.rows.set(`financial_accounts:${remoteAccount.id}`, remote('financial_accounts', remoteAccount, 1))
    const changed: AppState[] = []
    coordinator = new SyncCoordinator(db, provider, {
      load: async () => value,
      save: async (next) => { value = next; return next },
      changed: (next) => { changed.push(next); value = next },
    }, remoteHouseholdId, 'new-origin-device', 3)

    const opened = await coordinator.openRemoteHousehold(value)

    expect(provider.pullCount).toBe(1)
    expect(provider.pushCount).toBe(0)
    expect(opened?.household.id).toBe(remoteHouseholdId)
    expect(opened?.accounts.map((account) => account.name)).toEqual(['Remote account'])
    expect(opened?.transactions).toEqual([])
    expect(changed.at(-1)?.household.id).toBe(remoteHouseholdId)
    expect(await coordinator.isReady()).toBe(true)
  })

  it('does not mark a remote household ready when its initial pull fails', async () => {
    const remoteHouseholdId = crypto.randomUUID()
    provider.pullError = new Error('network failed')
    coordinator = new SyncCoordinator(db, provider, {
      load: async () => value,
      save: async (next) => { value = next; return next },
    }, remoteHouseholdId, 'new-origin-device', 3)

    await expect(coordinator.openRemoteHousehold(value)).rejects.toThrow('network failed')
    expect(provider.pushCount).toBe(0)
    expect(await coordinator.isReady()).toBe(false)
  })

  it('initial pull applies remote rows by entity', async () => {
    const item = { ...value.transactions[0], id: crypto.randomUUID(), title: 'Pulled', amountCents: 2500, transactionDate: '2026-08-20' }
    provider.rows.set(`transactions:${item.id}`, remote('transactions', item, 1))
    await coordinator.pull()
    expect(value.transactions.some((entry) => entry.id === item.id)).toBe(true)
  })

  it('preserves pending local payload during pull and records a version conflict', async () => {
    const item = value.transactions[0]
    await coordinator.queue.enqueue({ id: crypto.randomUUID(), householdId: value.household.id, entityType: 'transactions', entityId: item.id, operation: 'update', payload: { ...item, title: 'Pending' }, baseVersion: 1, createdAt: new Date().toISOString() })
    provider.rows.set(`transactions:${item.id}`, remote('transactions', { ...item, title: 'Remote' }, 2))
    await coordinator.pull()
    expect(value.transactions.find((entry) => entry.id === item.id)?.title).toBe(item.title)
    expect(await db.syncConflicts.where('status').equals('unresolved').count()).toBe(1)
  })

  it('applies Realtime update and delete after subscription without duplicating recurrences', async () => {
    await coordinator.startRealtime()
    const rule = value.recurringRules[0]
    provider.emit(remote('recurring_rules', { ...rule, name: 'Updated once' }, 2))
    await waitFor(() => {
      expect(value.recurringRules.filter((entry) => entry.id === rule.id)).toHaveLength(1)
      expect(value.recurringRules.find((entry) => entry.id === rule.id)?.name).toBe('Updated once')
    })
    provider.emit(remote('recurring_rules', { ...rule, name: 'Updated once' }, 3, new Date().toISOString()))
    await waitFor(() => {
      expect(value.recurringRules.some((entry) => entry.id === rule.id)).toBe(false)
    })
  })
})

describe('financial invariants at the sync boundary', () => {
  it('preserves integer cents and YYYY-MM-DD dates', () => {
    const item = value.transactions[0]
    const next = applyRemoteEntity(value, remote('transactions', { ...item, amountCents: 3799, transactionDate: '2026-08-13' }, 2))
    expect(next.transactions.find((entry) => entry.id === item.id)).toMatchObject({ amountCents: 3799, transactionDate: '2026-08-13' })
  })

  it('rejects fractional cents and timestamp-shaped financial dates', () => {
    const item = value.transactions[0]
    expect(() => applyRemoteEntity(value, remote('transactions', { ...item, amountCents: 37.99 }, 2))).toThrow()
    expect(() => applyRemoteEntity(value, remote('transactions', { ...item, transactionDate: '2026-08-13T10:00:00Z' }, 2))).toThrow()
  })
})
