import { z } from 'zod'
import type { AppSettings, AppState, Category, FinancialAccount, Household, HouseholdMember, RecurringRule, Transaction } from '@/domain/model'
import type { AppStateRepository } from '@/persistence'
import type { HomeCoinWebDatabase } from '@/persistence/web/db'
import type { SyncEntityType, SyncOperation } from './contracts'
import { validateEntityPayload } from './entities'
import { IndexedDbSyncQueue } from './queue'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface EntityRepository<T extends { id: string }> {
  list(householdId: string): Promise<T[]>
  get(id: string): Promise<T | null>
  put(value: T): Promise<T>
  remove(id: string): Promise<void>
}

export interface AccountRepository extends EntityRepository<FinancialAccount> { readonly repositoryEntity?: 'financial_accounts' }
export interface CategoryRepository extends EntityRepository<Category> { readonly repositoryEntity?: 'categories' }
export interface TransactionRepository extends EntityRepository<Transaction> { readonly repositoryEntity?: 'transactions' }
export interface RecurringRuleRepository extends EntityRepository<RecurringRule> { readonly repositoryEntity?: 'recurring_rules' }
export type SharedHouseholdSettings = Pick<AppSettings, 'locale' | 'currency' | 'weekStartDay' | 'financialMonthStartDay'>
export interface SettingsRepository {
  get(householdId: string): Promise<SharedHouseholdSettings | null>
  put(householdId: string, value: SharedHouseholdSettings): Promise<SharedHouseholdSettings>
}

export interface HouseholdSummary {
  household: Household
  membership: HouseholdMember
}

export interface HouseholdInvite {
  id: string
  householdId: string
  email: string
  role: 'member'
  expiresAt: string
  usedAt: string | null
}

export interface HouseholdRepository {
  list(): Promise<HouseholdSummary[]>
  create(household: Household, ownerName: string, deviceId?: string): Promise<HouseholdSummary>
  members(householdId: string): Promise<HouseholdMember[]>
  createInvite(householdId: string, email: string, expiresAt: string): Promise<{ invite: HouseholdInvite; token: string }>
  acceptInvite(token: string): Promise<HouseholdSummary>
  removeMember(householdId: string, membershipId: string): Promise<void>
  leave(householdId: string): Promise<void>
}

type EntityAdapter<T extends { id: string }> = {
  entityType: SyncEntityType
  select(state: AppState): T[]
  replace(state: AppState, values: T[]): AppState
}

export class IndexedDbRepository<T extends { id: string; householdId: string }> implements EntityRepository<T> {
  private readonly state: AppStateRepository
  private readonly adapter: EntityAdapter<T>

  constructor(state: AppStateRepository, adapter: EntityAdapter<T>) {
    this.state = state
    this.adapter = adapter
  }

  private async current() {
    const value = await this.state.load()
    if (!value) throw new Error('Local state is not initialized')
    return value
  }

  async list(householdId: string) {
    return this.adapter.select(await this.current()).filter((item) => item.householdId === householdId)
  }

  async get(id: string) {
    return this.adapter.select(await this.current()).find((item) => item.id === id) ?? null
  }

  async put(value: T) {
    const state = await this.current()
    const values = this.adapter.select(state)
    const next = values.some((item) => item.id === value.id)
      ? values.map((item) => item.id === value.id ? value : item)
      : [...values, value]
    await this.state.save(this.adapter.replace(state, next))
    return value
  }

  async remove(id: string) {
    const state = await this.current()
    await this.state.save(this.adapter.replace(state, this.adapter.select(state).filter((item) => item.id !== id)))
  }
}

type SupabaseRow = { id: string; household_id: string; payload: unknown }

export class SupabaseRepository<T extends { id: string; householdId: string }> implements EntityRepository<T> {
  private readonly client: SupabaseClient
  private readonly entityType: SyncEntityType

  constructor(
    client: SupabaseClient,
    entityType: SyncEntityType,
  ) {
    this.client = client
    this.entityType = entityType
  }

  private payload(row: SupabaseRow) {
    return validateEntityPayload<T>(this.entityType, row.payload)
  }

  async list(householdId: string) {
    const { data, error } = await this.client.from(this.entityType).select('id, household_id, payload')
      .eq('household_id', householdId).is('deleted_at', null)
    if (error) throw new Error(error.message)
    return (data as SupabaseRow[]).map((row) => this.payload(row))
  }

  async get(id: string) {
    const { data, error } = await this.client.from(this.entityType).select('id, household_id, payload')
      .eq('id', id).is('deleted_at', null).maybeSingle()
    if (error) throw new Error(error.message)
    return data ? this.payload(data as SupabaseRow) : null
  }

  async put(value: T) {
    const { data, error } = await this.client.from(this.entityType)
      .upsert({ id: value.id, household_id: value.householdId, payload: value, client_updated_at: new Date().toISOString() })
      .select('id, household_id, payload').single()
    if (error) throw new Error(error.message)
    return this.payload(data as SupabaseRow)
  }

  async remove(id: string) {
    const { error } = await this.client.from(this.entityType).update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error(error.message)
  }
}

export class IndexedDbSettingsRepository implements SettingsRepository {
  private readonly state: AppStateRepository
  constructor(state: AppStateRepository) { this.state = state }

  async get(householdId: string) {
    const state = await this.state.load()
    if (!state || state.household.id !== householdId) return null
    const { locale, currency, weekStartDay, financialMonthStartDay } = state.settings
    return { locale, currency, weekStartDay, financialMonthStartDay }
  }

  async put(householdId: string, value: SharedHouseholdSettings) {
    const state = await this.state.load()
    if (!state || state.household.id !== householdId) throw new Error('Local household is not available')
    await this.state.save({ ...state, settings: { ...state.settings, ...value } })
    return value
  }
}

export class SupabaseSettingsRepository implements SettingsRepository {
  private readonly client: SupabaseClient
  constructor(client: SupabaseClient) { this.client = client }

  async get(householdId: string) {
    const { data, error } = await this.client.from('settings').select('payload').eq('household_id', householdId).is('deleted_at', null).maybeSingle()
    if (error) throw new Error(error.message)
    return data ? validateEntityPayload<SharedHouseholdSettings>('settings', data.payload) : null
  }

  async put(householdId: string, value: SharedHouseholdSettings) {
    const payload = validateEntityPayload<SharedHouseholdSettings>('settings', value)
    const { data, error } = await this.client.from('settings').upsert({
      id: householdId, household_id: householdId, payload, client_updated_at: new Date().toISOString(),
    }).select('payload').single()
    if (error) throw new Error(error.message)
    return validateEntityPayload<SharedHouseholdSettings>('settings', data.payload)
  }
}

export class SyncingRepository<T extends { id: string; householdId: string }> implements EntityRepository<T> {
  private readonly local: EntityRepository<T>
  private readonly queue: IndexedDbSyncQueue
  private readonly db: HomeCoinWebDatabase
  private readonly entityType: SyncEntityType

  constructor(
    local: EntityRepository<T>,
    queue: IndexedDbSyncQueue,
    db: HomeCoinWebDatabase,
    entityType: SyncEntityType,
  ) {
    this.local = local
    this.queue = queue
    this.db = db
    this.entityType = entityType
  }

  list(householdId: string) { return this.local.list(householdId) }
  get(id: string) { return this.local.get(id) }

  async put(value: T) {
    const before = await this.local.get(value.id)
    const saved = await this.local.put(value)
    const metadata = await this.db.entitySyncMetadata.get(`${this.entityType}:${value.id}`)
    await this.queue.enqueueCoalesced({
      id: crypto.randomUUID(), householdId: value.householdId, entityType: this.entityType, entityId: value.id,
      operation: before ? 'update' : 'create', payload: saved, baseVersion: metadata?.version ?? 0, createdAt: new Date().toISOString(),
    })
    return saved
  }

  async remove(id: string) {
    const before = await this.local.get(id)
    if (!before) return
    await this.local.remove(id)
    const metadata = await this.db.entitySyncMetadata.get(`${this.entityType}:${id}`)
    await this.queue.enqueueCoalesced({
      id: crypto.randomUUID(), householdId: before.householdId, entityType: this.entityType, entityId: id,
      operation: 'delete', payload: before, baseVersion: metadata?.version ?? 0, createdAt: new Date().toISOString(),
    })
  }
}

const emailSchema = z.string().trim().email()

const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

type RpcResult = Record<string, unknown>

export class SupabaseHouseholdRepository implements HouseholdRepository {
  private readonly client: SupabaseClient

  constructor(client: SupabaseClient) {
    this.client = client
  }

  private summary(value: RpcResult): HouseholdSummary {
    return {
      household: validateEntityPayload<Household>('households', value.household),
      membership: validateEntityPayload<HouseholdMember>('household_members', value.membership),
    }
  }

  async list() {
    const { data, error } = await this.client.rpc('list_my_households')
    if (error) throw new Error(error.message)
    return ((data ?? []) as RpcResult[]).map((value) => this.summary(value))
  }

  async create(household: Household, ownerName: string, deviceId?: string) {
    const { data, error } = await this.client.rpc('create_household', {
      p_id: household.id, p_name: household.name, p_payload: household, p_owner_name: ownerName.trim() || 'Owner', p_device_id: deviceId ?? null,
    })
    if (error) throw new Error(error.message)
    return this.summary(data as RpcResult)
  }

  async members(householdId: string) {
    const { data, error } = await this.client.from('household_members').select('payload')
      .eq('household_id', householdId).is('deleted_at', null).order('created_at')
    if (error) throw new Error(error.message)
    return (data ?? []).map((row) => validateEntityPayload<HouseholdMember>('household_members', row.payload))
  }

  async createInvite(householdId: string, email: string, expiresAt: string) {
    const token = randomToken()
    const validEmail = emailSchema.parse(email)
    const { data, error } = await this.client.rpc('create_household_invite', {
      p_household_id: householdId, p_email: validEmail, p_role: 'member', p_token: token, p_expires_at: expiresAt,
    })
    if (error) throw new Error(error.message)
    const value = data as RpcResult
    const invite: HouseholdInvite = {
      id: String(value.id), householdId, email: validEmail, role: 'member', expiresAt: String(value.expires_at), usedAt: null,
    }
    return { invite, token }
  }

  async acceptInvite(token: string) {
    if (token.length < 32) throw new Error('This invitation token is invalid.')
    const { data, error } = await this.client.rpc('accept_household_invite', { p_token: token })
    if (error) throw new Error(error.message)
    return this.summary(data as RpcResult)
  }

  async removeMember(householdId: string, membershipId: string) {
    const { error } = await this.client.rpc('remove_household_member', { p_household_id: householdId, p_membership_id: membershipId })
    if (error) throw new Error(error.message)
  }

  async leave(householdId: string) {
    const { error } = await this.client.rpc('leave_household', { p_household_id: householdId })
    if (error) throw new Error(error.message)
  }
}

export const entityAdapters = {
  accounts: { entityType: 'financial_accounts', select: (state: AppState) => state.accounts, replace: (state: AppState, accounts: FinancialAccount[]) => ({ ...state, accounts }) },
  categories: { entityType: 'categories', select: (state: AppState) => state.categories, replace: (state: AppState, categories: Category[]) => ({ ...state, categories }) },
  transactions: { entityType: 'transactions', select: (state: AppState) => state.transactions, replace: (state: AppState, transactions: Transaction[]) => ({ ...state, transactions }) },
  recurringRules: { entityType: 'recurring_rules', select: (state: AppState) => state.recurringRules, replace: (state: AppState, recurringRules: RecurringRule[]) => ({ ...state, recurringRules }) },
} satisfies Record<string, EntityAdapter<FinancialAccount> | EntityAdapter<Category> | EntityAdapter<Transaction> | EntityAdapter<RecurringRule>>

export type { SyncOperation }
