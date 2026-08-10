import { describe, expect, it } from 'vitest'
import { createBackupPayload, serializeBackup, validateBackupPayload } from '@/domain/backup'
import { createDemoState } from '@/domain/seed'

describe('backup', () => {
  it('creates and validates a backup payload', async () => {
    const payload = await createBackupPayload(createDemoState())
    expect(payload.schemaVersion).toBe(1)
    expect(await validateBackupPayload(payload)).toBe(true)
  })

  it('serializes a readable json document', async () => {
    const json = await serializeBackup(createDemoState())
    const parsed = JSON.parse(json)
    expect(parsed.state.transactions.length).toBeGreaterThan(0)
  })
})
