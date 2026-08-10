import Database from '@tauri-apps/plugin-sql'
import { DATABASE_FILE, MIGRATIONS } from '@/database/migrations'
import { ensureCalculatedState } from '@/domain/calculations'
import type { AppState, AuditEvent, BackupRecord, ForecastSnapshot } from '@/domain/model'
import type { AppStateRepository, PersistenceMetadata } from '@/persistence/types'

type StoredStateRow = { schema_version: number; payload: string; updated_at: string }
const LEGACY_DATABASE_FILE = 'sqlite:home-finance.db'

let databasePromise: Promise<Database> | null = null
const splitStatements = (sql: string) => sql.split(';').map((statement) => statement.trim()).filter(Boolean)

export class TauriAppStateRepository implements AppStateRepository {
  async database() {
    databasePromise ??= Database.load(DATABASE_FILE)
    return databasePromise
  }

  async ensure() {
    const db = await this.database()
    await db.execute('PRAGMA foreign_keys = ON')
    for (const migration of MIGRATIONS) {
      const applied = await db.select<Array<{ version: number }>>('SELECT version FROM schema_migrations WHERE version = $1', [migration.version])
      if (applied.length) continue
      for (const statement of migration.statements.flatMap(splitStatements)) await db.execute(statement)
      await db.execute('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version])
    }
  }

  async load(): Promise<AppState | null> {
    await this.ensure()
    const db = await this.database()
    const rows = await db.select<StoredStateRow[]>('SELECT schema_version, payload, updated_at FROM app_state WHERE id = 1')
    if (rows.length) return JSON.parse(rows[0].payload) as AppState
    try {
      const legacyDb = await Database.load(LEGACY_DATABASE_FILE)
      const legacyRows = await legacyDb.select<StoredStateRow[]>('SELECT schema_version, payload, updated_at FROM app_state WHERE id = 1')
      if (legacyRows.length) return this.save(JSON.parse(legacyRows[0].payload) as AppState)
    } catch {
      // A missing legacy database is expected on a clean install.
    }
    return null
  }

  async save(state: AppState): Promise<AppState> {
    await this.ensure()
    const db = await this.database()
    const calculated = ensureCalculatedState(state)
    const updatedAt = new Date().toISOString()
    await db.execute(
      `INSERT INTO app_state (id, schema_version, payload, updated_at) VALUES (1, $1, $2, $3)
       ON CONFLICT(id) DO UPDATE SET schema_version = excluded.schema_version, payload = excluded.payload, updated_at = excluded.updated_at`,
      [calculated.schemaVersion, JSON.stringify(calculated), updatedAt],
    )
    return calculated
  }

  async clear() {
    await this.ensure()
    await (await this.database()).execute('DELETE FROM app_state WHERE id = 1')
  }

  async getMetadata(): Promise<PersistenceMetadata> {
    await this.ensure()
    const rows = await (await this.database()).select<StoredStateRow[]>('SELECT schema_version, payload, updated_at FROM app_state WHERE id = 1')
    return { source: 'sqlite', schemaVersion: rows[0]?.schema_version ?? null, updatedAt: rows[0]?.updated_at ?? null, migratedFromLocalStorage: false }
  }

  async appendAuditEvent(event: AuditEvent) {
    await this.ensure()
    await (await this.database()).execute(
      'INSERT INTO audit_events (id, created_at, entity_type, entity_id, action, details_json) VALUES ($1, $2, $3, $4, $5, $6)',
      [event.id, event.createdAt, event.entityType, event.entityId, event.action, event.detailsJson],
    )
  }

  async recordBackup(record: BackupRecord) {
    await this.ensure()
    await (await this.database()).execute(
      'INSERT INTO backups (id, created_at, file_name, file_path, schema_version, checksum, encrypted, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [record.id, record.createdAt, record.fileName, record.filePath, record.schemaVersion, record.checksum, record.encrypted ? 1 : 0, record.notes],
    )
  }

  async recordForecastSnapshot(snapshot: ForecastSnapshot) {
    await this.ensure()
    await (await this.database()).execute(
      'INSERT INTO forecast_snapshots (id, created_at, period_start, period_end, confidence, payload_json) VALUES ($1, $2, $3, $4, $5, $6)',
      [snapshot.id, snapshot.createdAt, snapshot.periodStart, snapshot.periodEnd, snapshot.confidence, snapshot.payloadJson],
    )
  }

  async updateSetting(key: string, value: unknown) {
    await this.ensure()
    await (await this.database()).execute(
      'INSERT INTO settings (key, value_json) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
      [key, JSON.stringify(value)],
    )
  }

  async readSetting<T>(key: string): Promise<T | null> {
    await this.ensure()
    const rows = await (await this.database()).select<Array<{ value_json: string }>>('SELECT value_json FROM settings WHERE key = $1', [key])
    return rows.length ? JSON.parse(rows[0].value_json) as T : null
  }
}

