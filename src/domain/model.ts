export type CurrencyCode = string

export type AccountType =
  | 'current'
  | 'joint'
  | 'credit-card'
  | 'cash'
  | 'savings'
  | 'investment'
  | 'loan'
  | 'financing'
  | 'manual'

export type TransactionType = 'income' | 'expense' | 'transfer' | 'adjustment'
export type TransactionStatus =
  | 'planned'
  | 'pending'
  | 'paid'
  | 'received'
  | 'overdue'
  | 'cancelled'
export type RecurrenceFrequency =
  | 'weekly'
  | 'fortnightly'
  | 'monthly'
  | 'bimonthly'
  | 'quarterly'
  | 'semiannual'
  | 'yearly'
  | 'custom'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface Household {
  id: string
  name: string
  currency: CurrencyCode
  locale: string
  financialMonthStartDay: number
  weekStartDay: number
  createdAt: string
}

export interface HouseholdMember {
  id: string
  householdId: string
  name: string
  role: string
  color: string
  active: boolean
}

export interface FinancialAccount {
  id: string
  householdId: string
  name: string
  institution: string
  type: AccountType
  currency: CurrencyCode
  openingBalanceCents: number
  currentBalanceCents: number
  holder: string
  accentColor: string
  archived: boolean
  notes: string
}

export interface Category {
  id: string
  householdId: string
  name: string
  group: string
  order: number
  archived: boolean
  color: string
  icon: string
}

export interface Merchant {
  id: string
  householdId: string
  name: string
  normalizedName: string
}

export interface TransactionSplit {
  id: string
  transactionId: string
  categoryId: string
  amountCents: number
  notes?: string
}

export interface Transaction {
  id: string
  householdId: string
  title: string
  description: string
  amountCents: number
  type: TransactionType
  categoryId: string
  subcategory?: string
  accountId: string
  counterpartyAccountId?: string
  transactionDate: string
  dueDate?: string
  paidDate?: string
  status: TransactionStatus
  personId?: string
  payee?: string
  paymentMethod?: string
  recurrenceRuleId?: string
  tags: string[]
  notes: string
  receiptUrl?: string
  source: 'manual' | 'imported'
  splits: TransactionSplit[]
  createdAt: string
  updatedAt: string
  cancelledAt?: string
}

export interface RecurringRule {
  id: string
  householdId: string
  name: string
  amountCents: number
  frequency: RecurrenceFrequency
  interval: number
  nextDueDate: string
  accountId: string
  categoryId: string
  personId?: string
  generateAutomatically: boolean
  reminder: boolean
  endDate?: string
  active: boolean
  notes?: string
}

export interface Budget {
  id: string
  householdId: string
  name: string
  scope: 'general' | 'category' | 'person'
  period: 'monthly' | 'custom'
  limitCents: number
  categoryId?: string
  personId?: string
  flexible: boolean
  rollover: boolean
  archived: boolean
}

export interface FinancialGoal {
  id: string
  householdId: string
  name: string
  targetCents: number
  currentCents: number
  targetDate?: string
  monthlyContributionCents: number
  accountId?: string
  priority: number
  notes: string
  archived: boolean
}

export interface Tag {
  id: string
  householdId: string
  name: string
  color: string
}

export interface CategorizationRule {
  id: string
  householdId: string
  priority: number
  field: 'description' | 'payee' | 'merchant' | 'amount'
  operator: 'contains' | 'equals' | 'startsWith' | 'amountEquals'
  pattern: string
  categoryId: string
  active: boolean
  applyToExisting: boolean
  notes: string
}

export interface ImportBatch {
  id: string
  householdId: string
  sourceName: string
  sourceType: 'csv' | 'paste' | 'bank-file'
  importedAt: string
  rowCount: number
  duplicateCount: number
  status: 'draft' | 'confirmed' | 'reverted'
  notes: string
}

export interface ImportRow {
  id: string
  importId: string
  rawJson: string
  status: 'new' | 'duplicate' | 'error' | 'confirmed'
  transactionId?: string
}

export interface Attachment {
  id: string
  transactionId: string
  fileName: string
  mimeType: string
  storagePath: string
  sizeBytes: number
}

export interface BackupRecord {
  id: string
  createdAt: string
  fileName: string
  filePath: string
  schemaVersion: number
  checksum: string
  encrypted: boolean
  notes: string
}

export interface AuditEvent {
  id: string
  createdAt: string
  entityType: string
  entityId: string
  action: string
  detailsJson: string
}

export interface ForecastSnapshot {
  id: string
  createdAt: string
  periodStart: string
  periodEnd: string
  confidence: 'low' | 'medium' | 'high'
  payloadJson: string
}

export interface AppSettings {
  theme: ThemeMode
  privacyMode: boolean
  hideSensitiveValues: boolean
  locale: string
  currency: CurrencyCode
  weekStartDay: number
  financialMonthStartDay: number
  pinEnabled: boolean
  lastBackupAt?: string
  backupDirectory?: string
  appLocked: boolean
}

export interface AppState {
  schemaVersion: number
  initializedAt: string
  onboardingCompleted: boolean
  demoEnabled: boolean
  household: Household
  members: HouseholdMember[]
  accounts: FinancialAccount[]
  categories: Category[]
  merchants: Merchant[]
  transactions: Transaction[]
  recurringRules: RecurringRule[]
  budgets: Budget[]
  goals: FinancialGoal[]
  tags: Tag[]
  categorizationRules: CategorizationRule[]
  imports: ImportBatch[]
  importRows: ImportRow[]
  attachments: Attachment[]
  backups: BackupRecord[]
  auditEvents: AuditEvent[]
  forecastSnapshots: ForecastSnapshot[]
  settings: AppSettings
}

export interface DashboardFilters {
  period: 'month' | 'quarter' | 'year' | 'custom'
  accountId?: string
  memberId?: string
  categoryId?: string
  status?: TransactionStatus | 'all'
  startDate?: string
  endDate?: string
}

export interface MoneyPoint {
  date: string
  balanceCents: number
}

export interface ForecastDay {
  date: string
  projectedBalanceCents: number
  incomeCents: number
  expenseCents: number
  recurringIncomeCents: number
  recurringExpenseCents: number
  note?: string
}

export interface DashboardSummary {
  consolidatedBalanceCents: number
  availableBalanceCents: number
  monthlyIncomeCents: number
  monthlyExpenseCents: number
  netResultCents: number
  budgetConsumedPercent: number
  accountsDueSoon: Transaction[]
  overdueTransactions: Transaction[]
  topCategories: Array<{ categoryId: string; categoryName: string; amountCents: number }>
  upcomingPayments: Transaction[]
  balanceSeries: MoneyPoint[]
  projection: ForecastDay[]
  comparisonToPreviousMonthCents: number
  healthScore: number
  healthLabel: string
  alerts: string[]
}

export interface WeeklySummary {
  rangeStart: string
  rangeEnd: string
  incomeCents: number
  expenseCents: number
  resultCents: number
  topCategories: Array<{ categoryId: string; categoryName: string; amountCents: number }>
  largestTransactions: Transaction[]
  paidBills: Transaction[]
  pendingBills: Transaction[]
  nextWeekBills: Transaction[]
  comparisonToPreviousWeekCents: number
  projectedEndOfMonthCents: number
  actions: Array<{ title: string; reason: string }>
}

export interface ImportColumnMapping {
  date?: string
  description?: string
  debit?: string
  credit?: string
  value?: string
  balance?: string
  currency?: string
  reference?: string
  payee?: string
}

export interface ImportPreviewRow {
  index: number
  raw: Record<string, string>
  parsed?: Partial<Transaction>
  duplicate: boolean
  issue?: string
}

export interface ImportPreview {
  rows: ImportPreviewRow[]
  summary: {
    totalRows: number
    parsedRows: number
    duplicateRows: number
    errorRows: number
  }
}
