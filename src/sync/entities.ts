import { z } from 'zod'
import type {
  AppSettings,
  AppState,
  Category,
  FinancialAccount,
  Household,
  HouseholdMember,
  RecurringRule,
  Transaction,
} from '@/domain/model'
import { createBlankState } from '@/domain/seed'
import type { RemoteEntity, SyncEntityType, SyncOperation } from './contracts'

const id = z.string().min(1)
const cents = z.number().int().safe()
const financialDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const isoTimestamp = z.string().datetime({ offset: true })

const householdSchema = z.object({
  id, name: z.string().min(1).max(120), currency: z.string().min(3), locale: z.string().min(2),
  financialMonthStartDay: z.number().int().min(1).max(31), weekStartDay: z.number().int().min(0).max(6), createdAt: isoTimestamp,
})

const memberSchema = z.object({
  id, householdId: id, name: z.string().min(1), role: z.string().min(1), color: z.string(), active: z.boolean(),
})

const accountSchema = z.object({
  id, householdId: id, name: z.string().min(1), institution: z.string(), type: z.string(), currency: z.string(),
  openingBalanceCents: cents, currentBalanceCents: cents, holder: z.string(), accentColor: z.string(), archived: z.boolean(), notes: z.string(),
})

const categorySchema = z.object({
  id, householdId: id, name: z.string().min(1), group: z.string(), order: z.number().int(), archived: z.boolean(), color: z.string(), icon: z.string(),
})

const splitSchema = z.object({ id, transactionId: id, categoryId: id, amountCents: cents, notes: z.string().optional() })
const transactionSchema = z.object({
  id, householdId: id, title: z.string().min(1), description: z.string(), amountCents: cents.nonnegative(),
  type: z.enum(['income', 'expense', 'transfer', 'adjustment']), categoryId: z.string(), subcategory: z.string().optional(),
  accountId: z.string(), counterpartyAccountId: z.string().optional(), transactionDate: financialDate, dueDate: financialDate.optional(),
  paidDate: financialDate.optional(), status: z.enum(['planned', 'pending', 'paid', 'received', 'overdue', 'cancelled']),
  personId: z.string().optional(), payee: z.string().optional(), paymentMethod: z.string().optional(), recurrenceRuleId: z.string().optional(),
  tags: z.array(z.string()), notes: z.string(), receiptUrl: z.string().optional(), source: z.enum(['manual', 'imported']),
  splits: z.array(splitSchema), createdAt: isoTimestamp, updatedAt: isoTimestamp, cancelledAt: isoTimestamp.optional(),
})

const recurringRuleSchema = z.object({
  id, householdId: id, name: z.string().min(1), amountCents: cents.positive(),
  frequency: z.enum(['weekly', 'fortnightly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'yearly', 'custom']),
  interval: z.number().int().positive(), nextDueDate: financialDate, accountId: z.string(), categoryId: z.string(), personId: z.string().optional(),
  generateAutomatically: z.boolean(), reminder: z.boolean(), endDate: financialDate.optional(), active: z.boolean(), notes: z.string().optional(),
})

const settingsSchema = z.object({
  locale: z.string(), currency: z.string(), weekStartDay: z.number().int().min(0).max(6),
  financialMonthStartDay: z.number().int().min(1).max(31),
})

export const entityPayloadSchemas: Record<SyncEntityType, z.ZodType> = {
  households: householdSchema,
  household_members: memberSchema,
  financial_accounts: accountSchema,
  categories: categorySchema,
  transactions: transactionSchema,
  recurring_rules: recurringRuleSchema,
  settings: settingsSchema,
}

export function validateEntityPayload<T>(entityType: SyncEntityType, payload: unknown): T {
  return entityPayloadSchemas[entityType].parse(payload) as T
}

type SharedSettings = Pick<AppSettings, 'locale' | 'currency' | 'weekStartDay' | 'financialMonthStartDay'>
type SyncEntity = Household | HouseholdMember | FinancialAccount | Category | Transaction | RecurringRule | SharedSettings

export interface StateEntityRecord {
  entityType: SyncEntityType
  entityId: string
  householdId: string
  payload: SyncEntity
}

export function stateEntities(state: AppState): StateEntityRecord[] {
  const householdId = state.household.id
  return [
    { entityType: 'households', entityId: householdId, householdId, payload: state.household },
    ...state.accounts.map((payload) => ({ entityType: 'financial_accounts' as const, entityId: payload.id, householdId, payload })),
    ...state.categories.map((payload) => ({ entityType: 'categories' as const, entityId: payload.id, householdId, payload })),
    ...state.transactions.map((payload) => ({ entityType: 'transactions' as const, entityId: payload.id, householdId, payload })),
    ...state.recurringRules.map((payload) => ({ entityType: 'recurring_rules' as const, entityId: payload.id, householdId, payload })),
    { entityType: 'settings', entityId: householdId, householdId, payload: {
      locale: state.settings.locale, currency: state.settings.currency,
      weekStartDay: state.settings.weekStartDay, financialMonthStartDay: state.settings.financialMonthStartDay,
    } },
  ]
}

const comparable = (value: unknown) => JSON.stringify(value)
const recordKey = (record: Pick<StateEntityRecord, 'entityType' | 'entityId'>) => `${record.entityType}:${record.entityId}`

export function diffSyncEntities(previous: AppState, next: AppState) {
  const before = new Map(stateEntities(previous).map((record) => [recordKey(record), record]))
  const after = new Map(stateEntities(next).map((record) => [recordKey(record), record]))
  const changes: Array<{ record: StateEntityRecord; operation: SyncOperation['operation'] }> = []

  for (const [key, record] of after) {
    const old = before.get(key)
    if (!old) changes.push({ record, operation: 'create' })
    else if (comparable(old.payload) !== comparable(record.payload)) changes.push({ record, operation: 'update' })
  }
  for (const [key, record] of before) {
    if (!after.has(key)) changes.push({ record, operation: 'delete' })
  }
  return changes
}

function upsert<T extends { id: string }>(items: T[], value: T) {
  const index = items.findIndex((item) => item.id === value.id)
  return index < 0 ? [...items, value] : items.map((item, current) => current === index ? value : item)
}

function without<T extends { id: string }>(items: T[], idToRemove: string) {
  return items.filter((item) => item.id !== idToRemove)
}

export function applyRemoteEntity(state: AppState, remote: RemoteEntity): AppState {
  const next = structuredClone(state)
  const deleted = Boolean(remote.deletedAt)
  switch (remoteEntityType(remote)) {
    case 'households':
      if (!deleted) next.household = validateEntityPayload<Household>('households', remote.payload)
      break
    case 'household_members':
      next.members = deleted ? without(next.members, remote.id) : upsert(next.members, validateEntityPayload<HouseholdMember>('household_members', remote.payload))
      break
    case 'financial_accounts':
      next.accounts = deleted ? without(next.accounts, remote.id) : upsert(next.accounts, validateEntityPayload<FinancialAccount>('financial_accounts', remote.payload))
      break
    case 'categories':
      next.categories = deleted ? without(next.categories, remote.id) : upsert(next.categories, validateEntityPayload<Category>('categories', remote.payload))
      break
    case 'transactions':
      next.transactions = deleted ? without(next.transactions, remote.id) : upsert(next.transactions, validateEntityPayload<Transaction>('transactions', remote.payload))
      break
    case 'recurring_rules':
      next.recurringRules = deleted ? without(next.recurringRules, remote.id) : upsert(next.recurringRules, validateEntityPayload<RecurringRule>('recurring_rules', remote.payload))
      break
    case 'settings':
      if (!deleted) next.settings = { ...next.settings, ...validateEntityPayload<SharedSettings>('settings', remote.payload) }
      break
  }
  return next
}

export function buildRemoteHouseholdState(householdId: string, changes: RemoteEntity[], deviceState?: AppState): AppState {
  const householdRecord = changes.find((remote) => remoteEntityType(remote) === 'households' && remote.id === householdId && !remote.deletedAt)
  if (!householdRecord) throw new Error('The selected remote household is unavailable.')
  if (changes.some((remote) => remote.householdId !== householdId)) throw new Error('Remote household data was mixed across households.')

  const blank = createBlankState()
  let snapshot: AppState = {
    ...blank,
    onboardingCompleted: true,
    household: { ...blank.household, id: householdId },
    members: [],
    accounts: [],
    categories: [],
    transactions: [],
    recurringRules: [],
    settings: {
      ...blank.settings,
      theme: deviceState?.settings.theme ?? blank.settings.theme,
      privacyMode: deviceState?.settings.privacyMode ?? blank.settings.privacyMode,
      hideSensitiveValues: deviceState?.settings.hideSensitiveValues ?? blank.settings.hideSensitiveValues,
      pinEnabled: deviceState?.settings.pinEnabled ?? blank.settings.pinEnabled,
      appLocked: deviceState?.settings.appLocked ?? blank.settings.appLocked,
      lastBackupAt: deviceState?.settings.lastBackupAt,
      backupDirectory: deviceState?.settings.backupDirectory,
    },
  }
  for (const remote of changes) snapshot = applyRemoteEntity(snapshot, remote)
  if (snapshot.household.id !== householdId) throw new Error('Remote household identity did not match the selection.')
  return snapshot
}

export type TypedRemoteEntity = RemoteEntity & { entityType: SyncEntityType }

export function remoteEntityType(remote: RemoteEntity): SyncEntityType {
  const value = (remote as Partial<TypedRemoteEntity>).entityType
  if (!value || !(value in entityPayloadSchemas)) throw new Error('Remote entity type is missing or invalid')
  return value
}
