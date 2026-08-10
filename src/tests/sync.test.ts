import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HomeCoinWebDatabase } from '@/persistence'
import { DisabledSyncProvider, IndexedDbSyncQueue, type SyncOperation } from '@/sync'

let db: HomeCoinWebDatabase
let queue: IndexedDbSyncQueue

const operation = (): SyncOperation => ({
  id: crypto.randomUUID(),
  householdId: 'household-1',
  entityType: 'transaction',
  entityId: 'transaction-1',
  operation: 'update',
  payload: { amountCents: 3_799, dueDate: '2026-08-13' },
  baseVersion: 2,
  createdAt: '2026-08-04T12:00:00.000Z',
  attempts: 0,
  status: 'pending',
})

beforeEach(() => {
  db = new HomeCoinWebDatabase(`homecoin-sync-test-${crypto.randomUUID()}`)
  queue = new IndexedDbSyncQueue(db)
})

afterEach(async () => {
  db.close()
  await db.delete()
})

describe('disabled sync preparation', () => {
  it('persists cents and financial dates without transformation', async () => {
    const expected = operation()
    await queue.enqueue(expected)
    const [stored] = await queue.list('pending')
    expect(stored.payload).toEqual({ amountCents: 3_799, dueDate: '2026-08-13' })
  })

  it('persists pending, retry, failure, and conflict states in IndexedDB', async () => {
    const expected = operation()
    await queue.enqueue(expected)
    await queue.mark(expected.id, 'syncing')
    await queue.mark(expected.id, 'failed', 'offline')
    await queue.mark(expected.id, 'conflict', 'remote version differs')
    const [stored] = await queue.list('conflict')
    expect(stored.attempts).toBe(2)
    expect(stored.lastError).toBe('remote version differs')
    expect(stored.payload).toEqual(expected.payload)
  })

  it('does not make requests or accept operations while sync is disabled', async () => {
    const provider = new DisabledSyncProvider()
    const expected = operation()
    const result = await provider.push([expected])
    expect(result.acceptedIds).toEqual([])
    expect(result.failed).toEqual([{ operationId: expected.id, error: 'Sync is disabled' }])
    expect(await provider.pull()).toEqual({ changes: [] })
  })
})
