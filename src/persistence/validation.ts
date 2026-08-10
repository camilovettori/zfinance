import type { AppState } from '@/domain/model'

export function isValidAppState(value: unknown): value is AppState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AppState>
  return (
    Number.isInteger(candidate.schemaVersion)
    && typeof candidate.initializedAt === 'string'
    && typeof candidate.onboardingCompleted === 'boolean'
    && !!candidate.household
    && typeof candidate.household.id === 'string'
    && Array.isArray(candidate.accounts)
    && Array.isArray(candidate.categories)
    && Array.isArray(candidate.transactions)
    && Array.isArray(candidate.recurringRules)
    && Array.isArray(candidate.goals)
    && !!candidate.settings
  )
}

