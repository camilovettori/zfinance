import type { AppState, BackupRecord } from './model'
import { ensureCalculatedState } from './calculations'

export interface BackupPayload {
  schemaVersion: number
  appVersion: string
  exportedAt: string
  checksum: string
  state: AppState
}

const toHex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

export async function checksumText(text: string) {
  const encoded = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return toHex(new Uint8Array(digest))
}

export async function createBackupPayload(state: AppState, appVersion = '0.1.0'): Promise<BackupPayload> {
  const normalizedState = ensureCalculatedState(state)
  const base = {
    schemaVersion: normalizedState.schemaVersion,
    appVersion,
    exportedAt: new Date().toISOString(),
    state: normalizedState,
  }
  const checksum = await checksumText(JSON.stringify(base))

  return {
    ...base,
    checksum,
  }
}

export async function serializeBackup(state: AppState, appVersion = '0.1.0') {
  return JSON.stringify(await createBackupPayload(state, appVersion), null, 2)
}

export function isBackupPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<BackupPayload>
  return (
    typeof candidate.schemaVersion === 'number' &&
    typeof candidate.appVersion === 'string' &&
    typeof candidate.exportedAt === 'string' &&
    typeof candidate.checksum === 'string' &&
    Boolean(candidate.state)
  )
}

export async function validateBackupPayload(payload: BackupPayload) {
  const base = {
    schemaVersion: payload.schemaVersion,
    appVersion: payload.appVersion,
    exportedAt: payload.exportedAt,
    state: payload.state,
  }
  const checksum = await checksumText(JSON.stringify(base))
  return checksum === payload.checksum
}

export function createBackupRecord(
  fileName: string,
  filePath: string,
  checksum: string,
  schemaVersion: number,
  notes = '',
): BackupRecord {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    fileName,
    filePath,
    schemaVersion,
    checksum,
    encrypted: false,
    notes,
  }
}
