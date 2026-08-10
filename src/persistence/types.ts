import type { AppState } from '@/domain/model'

export type PersistenceSource = 'sqlite' | 'indexeddb'
export type PersistenceStatus = 'loading' | 'saving' | 'saved' | 'error'

export interface PersistenceMetadata {
  source: PersistenceSource
  schemaVersion: number | null
  updatedAt: string | null
  migratedFromLocalStorage: boolean
}

export interface AppStateRepository {
  load(): Promise<AppState | null>
  save(state: AppState): Promise<AppState>
  clear(): Promise<void>
  getMetadata(): Promise<PersistenceMetadata>
}

