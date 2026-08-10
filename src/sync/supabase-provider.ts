import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { normalizeSyncEntityType } from './contracts'
import { HOMECOIN_SCHEMA } from './schema'
import type { RemoteEntity, SyncEntityType, SyncEventHandler, SyncOperation, SyncProvider, SyncPullResult, SyncPushResult, Unsubscribe } from './contracts'

const TABLES: SyncEntityType[] = [
  'households', 'household_members', 'financial_accounts', 'categories', 'transactions', 'recurring_rules', 'settings',
]

type RemoteRow = Record<string, unknown>

function stringField(row: RemoteRow, key: string, fallback = '') {
  const value = row[key]
  return typeof value === 'string' ? value : fallback
}

function toRemote(entityType: SyncEntityType, row: RemoteRow): RemoteEntity & { entityType: SyncEntityType } {
  const updatedAt = stringField(row, 'updated_at', new Date().toISOString())
  return {
    entityType,
    id: stringField(row, 'id'),
    householdId: stringField(row, 'household_id', stringField(row, 'id')),
    payload: row.payload,
    createdAt: stringField(row, 'created_at', updatedAt),
    updatedAt,
    createdBy: stringField(row, 'created_by'),
    updatedBy: stringField(row, 'updated_by'),
    version: Number(row.version ?? 0),
    deletedAt: typeof row.deleted_at === 'string' ? row.deleted_at : null,
    clientUpdatedAt: stringField(row, 'client_updated_at', updatedAt),
    deviceId: typeof row.device_id === 'string' ? row.device_id : null,
  }
}

const writePayload = (operation: SyncOperation, deviceId: string) => ({
  id: operation.entityId,
  household_id: operation.householdId,
  payload: operation.payload,
  client_updated_at: operation.createdAt,
  device_id: deviceId,
})

export class SupabaseSyncProvider implements SyncProvider {
  private readonly client: SupabaseClient
  private readonly householdId: string
  private readonly deviceId: string

  constructor(
    client: SupabaseClient,
    householdId: string,
    deviceId: string,
  ) {
    this.client = client
    this.householdId = householdId
    this.deviceId = deviceId
  }

  async push(operations: SyncOperation[]): Promise<SyncPushResult> {
    const result: SyncPushResult = { acceptedIds: [], accepted: [], conflicts: [], failed: [] }
    for (const operation of operations) {
      try {
        const table = normalizeSyncEntityType(operation.entityType)
        let response: { data: RemoteRow[] | null; error: { message: string } | null }
        if (operation.operation === 'create') {
          response = await this.client.from(table).insert(writePayload(operation, this.deviceId)).select()
        } else {
          const patch = operation.operation === 'delete'
            ? { deleted_at: new Date().toISOString(), client_updated_at: operation.createdAt, device_id: this.deviceId }
            : { payload: operation.payload, client_updated_at: operation.createdAt, device_id: this.deviceId }
          response = await this.client.from(table).update(patch)
            .eq('id', operation.entityId)
            .eq('household_id', operation.householdId)
            .eq('version', operation.baseVersion)
            .select()
        }

        if (response.error) {
          result.failed.push({ operationId: operation.id, error: response.error.message })
          continue
        }
        const row = response.data?.[0]
        if (!row) {
          const { data } = await this.client.from(table).select('*')
            .eq('id', operation.entityId).eq('household_id', operation.householdId).maybeSingle()
          result.conflicts.push({ operationId: operation.id, remote: data ? toRemote(table, data as RemoteRow) : null })
          continue
        }
        const remote = toRemote(table, row)
        result.acceptedIds.push(operation.id)
        result.accepted.push({ operationId: operation.id, remote })
      } catch (error) {
        result.failed.push({ operationId: operation.id, error: error instanceof Error ? error.message : 'Network request failed' })
      }
    }
    return result
  }

  async pull(cursor?: string): Promise<SyncPullResult> {
    const changes: Array<RemoteEntity & { entityType: SyncEntityType }> = []
    await Promise.all(TABLES.map(async (table) => {
      let query = this.client.from(table).select('*').eq('household_id', this.householdId).order('updated_at', { ascending: true })
      if (cursor) query = query.gt('updated_at', cursor)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      changes.push(...(data ?? []).map((row) => toRemote(table, row as RemoteRow)))
    }))
    changes.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    return { cursor: changes.at(-1)?.updatedAt ?? cursor ?? new Date().toISOString(), changes }
  }

  async subscribe(handler: SyncEventHandler): Promise<Unsubscribe> {
    const channel: RealtimeChannel = this.client.channel(`homecoin:${this.householdId}`)
    for (const table of TABLES) {
      channel.on('postgres_changes', {
        event: '*', schema: HOMECOIN_SCHEMA, table, filter: `household_id=eq.${this.householdId}`,
      }, (event) => {
        const row = (event.new && Object.keys(event.new).length ? event.new : event.old) as RemoteRow
        handler(toRemote(table, row))
      })
    }
    await channel.subscribe()
    return () => { void this.client.removeChannel(channel) }
  }
}
