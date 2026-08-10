import type { AppStateRepository } from './types'
import { isTauriRuntime } from './runtime'
import { TauriAppStateRepository } from './desktop/sqlite-state.repository'
import { WebIndexedDbAppStateRepository } from './web/web-state.repository'
import { recreateWebDatabase } from './web/db'

let repository: AppStateRepository | null = null

export function createAppStateRepository(): AppStateRepository {
  return isTauriRuntime() ? new TauriAppStateRepository() : new WebIndexedDbAppStateRepository()
}

export function getAppStateRepository() {
  repository ??= createAppStateRepository()
  return repository
}

export function setAppStateRepositoryForTests(next: AppStateRepository | null) {
  repository = next
}

export async function resetPersistenceForTests() {
  repository = null
  await recreateWebDatabase()
}

export * from './types'
export * from './runtime'
export * from './web/db'
export * from './web/migration'
export * from './web/web-state.repository'
export * from './desktop/sqlite-state.repository'
