export interface Migration {
  version: number
  statements: string[]
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS household (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        currency TEXT NOT NULL,
        locale TEXT NOT NULL,
        financial_month_start_day INTEGER NOT NULL,
        week_start_day INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS household_members (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        color TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS financial_accounts (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        name TEXT NOT NULL,
        institution TEXT NOT NULL,
        type TEXT NOT NULL,
        currency TEXT NOT NULL,
        opening_balance_cents INTEGER NOT NULL,
        current_balance_cents INTEGER NOT NULL,
        holder TEXT NOT NULL,
        accent_color TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        name TEXT NOT NULL,
        group_name TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        color TEXT NOT NULL,
        icon TEXT NOT NULL,
        FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS merchants (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS recurring_rules (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        name TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        frequency TEXT NOT NULL,
        interval_count INTEGER NOT NULL,
        next_due_date TEXT NOT NULL,
        account_id TEXT NOT NULL,
        category_id TEXT NOT NULL,
        person_id TEXT,
        generate_automatically INTEGER NOT NULL DEFAULT 1,
        reminder INTEGER NOT NULL DEFAULT 1,
        end_date TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS budgets (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        name TEXT NOT NULL,
        scope TEXT NOT NULL,
        period TEXT NOT NULL,
        limit_cents INTEGER NOT NULL,
        category_id TEXT,
        person_id TEXT,
        flexible INTEGER NOT NULL DEFAULT 0,
        rollover INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS budget_periods (
        id TEXT PRIMARY KEY,
        budget_id TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        planned_cents INTEGER NOT NULL,
        actual_cents INTEGER NOT NULL,
        FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS financial_goals (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        name TEXT NOT NULL,
        target_cents INTEGER NOT NULL,
        current_cents INTEGER NOT NULL,
        target_date TEXT,
        monthly_contribution_cents INTEGER NOT NULL,
        account_id TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        type TEXT NOT NULL,
        category_id TEXT NOT NULL,
        subcategory TEXT,
        account_id TEXT NOT NULL,
        counterparty_account_id TEXT,
        transaction_date TEXT NOT NULL,
        due_date TEXT,
        paid_date TEXT,
        status TEXT NOT NULL,
        person_id TEXT,
        payee TEXT,
        payment_method TEXT,
        recurrence_rule_id TEXT,
        notes TEXT NOT NULL DEFAULT '',
        receipt_url TEXT,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        cancelled_at TEXT,
        FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS transaction_splits (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL,
        category_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        notes TEXT,
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS transaction_tags (
        transaction_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        PRIMARY KEY (transaction_id, tag_id)
      )`,
      `CREATE TABLE IF NOT EXISTS categorization_rules (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        priority INTEGER NOT NULL,
        field TEXT NOT NULL,
        operator TEXT NOT NULL,
        pattern TEXT NOT NULL,
        category_id TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        apply_to_existing INTEGER NOT NULL DEFAULT 1,
        notes TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS imports (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_type TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        duplicate_count INTEGER NOT NULL,
        status TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS import_rows (
        id TEXT PRIMARY KEY,
        import_id TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        status TEXT NOT NULL,
        transaction_id TEXT,
        FOREIGN KEY (import_id) REFERENCES imports(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        encrypted INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        details_json TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS forecast_snapshots (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        confidence TEXT NOT NULL,
        payload_json TEXT NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_transactions_household_date ON transactions (household_id, transaction_date)',
      'CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions (category_id)',
      'CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions (account_id)',
      'CREATE INDEX IF NOT EXISTS idx_categories_household ON categories (household_id, sort_order)',
      'CREATE INDEX IF NOT EXISTS idx_rules_priority ON categorization_rules (household_id, priority)',
      'CREATE INDEX IF NOT EXISTS idx_recurring_due ON recurring_rules (household_id, next_due_date)',
      'CREATE INDEX IF NOT EXISTS idx_goals_priority ON financial_goals (household_id, priority)',
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
        payload_json TEXT NOT NULL,
        base_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        status TEXT NOT NULL CHECK (status IN ('synced', 'pending', 'syncing', 'conflict', 'failed')),
        next_attempt_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS entity_sync_metadata (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        household_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        remote_updated_at TEXT,
        confirmed_device_id TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (entity_type, entity_id)
      )`,
      `CREATE TABLE IF NOT EXISTS sync_conflicts (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL,
        household_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        local_payload_json TEXT NOT NULL,
        remote_payload_json TEXT,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_sync_queue_status_created ON sync_queue(status, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id)',
    ],
  },
]

export const DATABASE_FILE = 'sqlite:homecoin.db'
