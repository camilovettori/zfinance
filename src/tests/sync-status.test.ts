import { expect, it, vi } from 'vitest'
import { publishSyncStatus, subscribeSyncStatus } from '@/sync/status'

it('keeps background no-op checks silent while still reporting actual changes and errors', () => {
  const synced = { status: 'synced' as const, message: 'Synced', pending: 0 }
  publishSyncStatus(synced)
  const changed = vi.fn()
  const unsubscribe = subscribeSyncStatus(changed)
  publishSyncStatus({ ...synced })
  publishSyncStatus({ ...synced })
  expect(changed).toHaveBeenCalledTimes(1)
  publishSyncStatus({ status: 'syncing', message: 'Syncing', pending: 1 })
  publishSyncStatus(synced)
  publishSyncStatus({ status: 'error', message: 'Sync error', pending: 0 })
  expect(changed).toHaveBeenCalledTimes(4)
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error' }))
  unsubscribe()
})
