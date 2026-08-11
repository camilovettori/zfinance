import { cloneElement, isValidElement, lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { addDays, addMonths, endOfMonth, endOfYear, startOfMonth, startOfYear } from 'date-fns'
import { jsPDF } from 'jspdf'
import Papa from 'papaparse'
import { BaseDirectory, mkdir, writeTextFile } from '@tauri-apps/plugin-fs'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  CalendarDays,
  CalendarRange,
  CircleDollarSign,
  Eye,
  EyeOff,
  House,
  Landmark,
  Move,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  Settings,
  Target,
  Trash2,
  WalletCards,
} from 'lucide-react'
import { createBackupRecord, serializeBackup, validateBackupPayload } from '@/domain/backup'
import {
  buildCategoryDistribution,
  buildMonthCalendar,
  buildMonthlyTrend,
  buildNextWeeks,
  buildVisibleItems,
  buildWeekSnapshot,
  formatSimpleCurrency,
  formatSimpleDay,
  simpleKindLabel,
  simpleStatusLabel,
  summarizeRange,
  type SimpleItem,
} from '@/domain/home'
import { ensureCalculatedState } from '@/domain/calculations'
import { buildRollingBalanceProjection, currentSpendableBalance } from '@/domain/cashflow'
import { cleanupOneOffRecurringDuplicates, isSamePlannedEntry, isSameRecurringEntry } from '@/domain/deduplication'
import {
  buildPlannerPeriodMetrics,
  buildPlannerCycleSummary,
  buildPlanningWeeks,
  buildPlannerWeeksWithCarry,
  createPlannerCycle,
  expandPlanningRange,
  movePlannerCycle,
  savingsContributedInRange,
  type PlannerCycle,
} from '@/domain/planning'
import {
  completePlannerItem,
  isCompletedPlannerItem,
  moveOneOffPlannerItem,
  updateOneOffPlannerAmount,
  updatePlannerSeriesFromOccurrence,
  upsertPlannerOccurrenceOverride,
} from '@/domain/planner-actions'
import { createBlankState, createDemoState } from '@/domain/seed'
import type { AppState, FinancialGoal, HouseholdMember, RecurrenceFrequency, RecurringRule, ThemeMode, Transaction } from '@/domain/model'
import { fromIsoDate, todayIso, toIsoDate } from '@/lib/date'
import { AuthService } from '@/auth/auth-service'
import { loadState, recordBackup, saveState } from '@/services/storage'
import {
  deactivateSyncRuntime,
  enqueueSyncChanges,
  getSupabaseClient,
  getSyncStatus,
  registerSyncedStateListener,
  restoreActiveSyncRuntime,
  subscribeSyncStatus,
  syncConfiguration,
  type CloudSyncSnapshot,
} from '@/sync'
import { MonthlyPlannerSummary, MonthlyPlannerView, PlannerSavingsSummary } from './MonthlyPlanner'
import { MobileDashboard } from './dashboard/MobileDashboard'
import { DesktopNavigation } from './navigation/DesktopNavigation'
import { MobileBottomNavigation } from './navigation/MobileBottomNavigation'
import { SECTION_ITEMS, type SectionKey } from './navigation/sections'
import { MobilePlannerView } from './planner/MobilePlannerView'

const SharingPanel = lazy(() => import('@/components/sync/SharingPanel').then((module) => ({ default: module.SharingPanel })))

type CalendarMode = 'month' | 'list'
type ReportPeriod = 'week' | 'month' | 'year' | 'custom'
type SimpleKind = 'income' | 'bill'
type RecurrenceChoice = 'once' | 'weekly' | 'fortnightly' | 'monthly' | 'yearly'
type BillFilter = 'all' | 'pay' | 'receive' | 'overdue'
type ActivityFilter = 'all' | 'income' | 'expense'
type RecurringTab = 'income' | 'expense'

const privateSyncLabel = (sync: CloudSyncSnapshot) => {
  if (sync.status === 'synced') return 'Private • shared • synced'
  if (sync.status === 'connecting' || sync.status === 'syncing') return 'Private • shared • connecting'
  if (sync.status === 'offline') return 'Private • shared • offline'
  if (sync.status === 'changes-waiting') return 'Private • shared • pending'
  if (sync.status === 'error' || sync.status === 'failed' || sync.status === 'conflict') return 'Private • shared • error'
  return 'Private • local'
}

const persistenceSyncLabel = (sync: CloudSyncSnapshot) => {
  if (sync.status === 'synced') return 'Synced'
  if (sync.status === 'connecting' || sync.status === 'syncing') return 'Connecting'
  if (sync.status === 'error' || sync.status === 'failed' || sync.status === 'conflict') return 'Sync error'
  return 'Saved locally'
}

type DeleteDialogState =
  | { kind: 'bills'; items: SimpleItem[] }
  | { kind: 'recurring'; rules: RecurringRule[] }

type ToastState = {
  message: string
  undo?: () => Promise<void>
}

type PlannerScope = 'occurrence' | 'series'

type PlannerMoveState = {
  item: SimpleItem
  targetDate: string
  scope: PlannerScope
}

type PlannerAmountState = {
  item: SimpleItem
  amount: string
  scope: PlannerScope
}

type TransactionDraft = {
  kind: SimpleKind
  title: string
  amount: string
  date: string
  recurrence: RecurrenceChoice
  categoryId: string
  accountId: string
  personId: string
  notes: string
}

type RuleDraft = {
  kind: SimpleKind
  name: string
  amount: string
  frequency: Exclude<RecurrenceChoice, 'once'>
  nextDueDate: string
  categoryId: string
  accountId: string
  personId: string
  notes: string
  active: boolean
}

type OnboardingDraft = {
  currency: string
  weekStartDay: number
  currentBalance: string
  addStarterItems: boolean
  salaryName: string
  salaryAmount: string
  billName: string
  billAmount: string
}

type TransactionModalState = {
  phase: 'choose' | 'form'
  source: 'new' | 'transaction' | 'recurring'
  editScope: 'occurrence' | 'series'
  transactionId?: string
  linkedRuleId?: string
  occurrenceDate?: string
  allowRecurrence: boolean
  draft: TransactionDraft
}

type RuleModalState = {
  ruleId?: string
  draft: RuleDraft
}

type GoalDraft = {
  name: string
  targetAmount: string
  currentAmount: string
  monthlyContribution: string
  targetDate: string
  notes: string
}

type GoalModalState = {
  goalId?: string
  contributionOnly?: boolean
  draft: GoalDraft
}

const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]

const REPORT_PERIOD_OPTIONS: Array<{ value: ReportPeriod; label: string }> = [
  { value: 'week', label: 'Weekly planner' },
  { value: 'month', label: 'Monthly planner' },
  { value: 'year', label: 'Annual summary' },
  { value: 'custom', label: 'Custom range' },
]

const CURRENCY_OPTIONS = ['EUR', 'USD', 'GBP', 'BRL']

const FREQUENCY_LABELS: Record<RecurrenceChoice, string> = {
  once: 'One-off',
  weekly: 'Weekly',
  fortnightly: 'Biweekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
}

const RECURRENCE_TO_FREQUENCY: Record<Exclude<RecurrenceChoice, 'once'>, RecurrenceFrequency> = {
  weekly: 'weekly',
  fortnightly: 'fortnightly',
  monthly: 'monthly',
  yearly: 'yearly',
}

const recurrenceChoiceFromFrequency = (frequency: RecurrenceFrequency): Exclude<RecurrenceChoice, 'once'> => {
  if (frequency === 'weekly' || frequency === 'fortnightly' || frequency === 'yearly') {
    return frequency
  }
  return 'monthly'
}

const RESULT_COLORS = ['#2F7D5B', '#4A6FA5', '#D97757', '#6BA368', '#8B6F9C', '#D6A85F']

const money = (amountCents: number, state: AppState | null) =>
  state ? formatSimpleCurrency(amountCents, state.settings.locale, state.settings.currency, state.settings.hideSensitiveValues || state.settings.privacyMode) : ''

const financialRangeLabel = (startIso: string, endIso: string, locale: string) => {
  const start = fromIsoDate(startIso)
  const end = fromIsoDate(endIso)
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()
  const startLabel = new Intl.DateTimeFormat(locale, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' }).format(start)
  const endLabel = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(end)
  return `${startLabel}–${endLabel}`
}

const defaultCategoryId = (state: AppState | null, kind: SimpleKind) => {
  if (!state) {
    return ''
  }

  if (kind === 'income') {
    return state.categories.find((category) => !category.archived && (category.group === 'Income' || category.group === 'Receitas'))?.id ?? state.categories.find((category) => !category.archived)?.id ?? ''
  }

  return (
    state.categories.find((category) => !category.archived && !['Income', 'Receitas', 'Transfers', 'Movimento'].includes(category.group))?.id ??
    state.categories.find((category) => !category.archived)?.id ??
    ''
  )
}

const defaultAccountId = (state: AppState | null) => state?.accounts[0]?.id ?? ''
const defaultPersonId = (state: AppState | null) => state?.members[0]?.id ?? ''

const defaultTransactionDraft = (state: AppState | null, kind: SimpleKind = 'bill', date = todayIso()): TransactionDraft => ({
  kind,
  title: kind === 'income' ? 'Salary' : 'Bill',
  amount: '',
  date,
  recurrence: 'once',
  categoryId: defaultCategoryId(state, kind),
  accountId: defaultAccountId(state),
  personId: defaultPersonId(state),
  notes: '',
})

const emptyOnboardingDraft = (): OnboardingDraft => ({
  currency: 'USD',
  weekStartDay: 1,
  currentBalance: '0',
  addStarterItems: true,
  salaryName: 'My salary',
  salaryAmount: '0',
  billName: 'First bill',
  billAmount: '0',
})

const parseMoney = (value: string) => {
  const cleaned = value.trim().replace(/[^\d,.-]/g, '')
  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  const decimalSeparator = lastComma >= 0 && lastDot >= 0
    ? lastComma > lastDot ? ',' : '.'
    : lastComma >= 0
      ? cleaned.length - lastComma - 1 <= 2 ? ',' : null
      : lastDot >= 0 && cleaned.length - lastDot - 1 <= 2 ? '.' : null
  const normalized = decimalSeparator
    ? `${cleaned.slice(0, cleaned.lastIndexOf(decimalSeparator)).replace(/[.,]/g, '')}.${cleaned.slice(cleaned.lastIndexOf(decimalSeparator) + 1)}`
    : cleaned.replace(/[.,]/g, '')
  const amount = Number(normalized)
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0
}

const actionLabel = (item: SimpleItem) => (item.kind === 'income' ? 'Receive' : 'Pay')

const setDocumentTheme = (theme: ThemeMode) => {
  const resolved =
    theme === 'system'
      ? window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme

  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved === 'dark' ? 'dark' : 'light'
}

const isDesktopRuntime = () => '__TAURI_INTERNALS__' in window

function Button({
  variant = 'secondary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const styles =
    variant === 'primary' ? 'button-primary' : variant === 'ghost' ? 'button-ghost' : 'button-secondary'
  return <button className={`${styles} ${className}`.trim()} {...props} />
}

function Card({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`.trim()} {...props} />
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return htmlFor ? <label className="field-label" htmlFor={htmlFor}>{children}</label> : <div className="field-label">{children}</div>
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  const generatedId = useId()
  const isNativeControl = isValidElement<{ id?: string }>(children)
    && typeof children.type === 'string'
    && ['input', 'select', 'textarea'].includes(children.type)
  const controlId = isNativeControl ? children.props.id ?? generatedId : undefined
  const labelledChild = isNativeControl ? cloneElement(children, { id: controlId }) : children
  return (
    <div>
      <Label htmlFor={controlId}>{label}</Label>
      {labelledChild}
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}

function ModalShell({
  title,
  subtitle,
  onClose,
  className = '',
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  className?: string
  children: React.ReactNode
}) {
  const titleId = useId()
  return (
    <div className="modal-backdrop flex items-center justify-center p-4" onMouseDown={onClose} role="presentation">
      <div className={`card modal-panel ${className}`} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--border)] px-5 py-4">
          <div>
            <h2 id={titleId} className="text-xl font-bold tracking-tight text-slate-900">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Close dialog">
            Close
          </Button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  )
}

function SideDrawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
}) {
  const titleId = useId()
  return (
    <div className="modal-backdrop flex justify-end" onMouseDown={onClose} role="presentation">
      <div className="card drawer-panel h-full" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="border-b border-[color:var(--border)] px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id={titleId} className="text-xl font-bold tracking-tight text-slate-900">{title}</h2>
              {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
            </div>
            <Button variant="ghost" onClick={onClose} aria-label="Close panel">
              Close
            </Button>
          </div>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: 'planned' | 'completed' | 'overdue' }) {
  return (
    <span className="status-pill" data-status={status}>
      {simpleStatusLabel(status)}
    </span>
  )
}

function MetricCard({
  label,
  value,
  highlight = false,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className={`card p-5 ${highlight ? 'metric-hero' : ''}`}>
      <div className="metric-subtle">{label}</div>
      <div className={`metric-value mt-3 ${highlight ? 'text-emerald-900' : 'text-slate-900'}`}>{value}</div>
    </div>
  )
}

function EmptyState({
  title,
  copy,
  action,
  onAction,
}: {
  title: string
  copy: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="empty-state">
      <div className="empty-illustration" aria-hidden="true"><House size={26} /></div>
      <strong>{title}</strong>
      <p>{copy}</p>
      {action && onAction ? <Button variant="primary" onClick={onAction}>{action}</Button> : null}
    </div>
  )
}

function ItemRow({
  item,
  state,
  onToggle,
  onEdit,
}: {
  item: SimpleItem
  state: AppState
  onToggle: (item: SimpleItem) => void
  onEdit: (item: SimpleItem) => void
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--border)] bg-white px-4 py-3 shadow-[0_8px_18px_rgba(45,58,58,0.05)] transition hover:-translate-y-0.5 hover:border-emerald-200"
      onClick={() => onEdit(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onEdit(item)
        }
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-semibold text-slate-900">{item.title}</p>
          <StatusBadge status={item.status} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <span>{item.dayLabel}</span>
          <span>•</span>
          <span>{item.sourceKind === 'recurring' ? 'Recurring' : 'One-off'}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-right">
          <div className="font-semibold text-slate-900">{money(item.amountCents, state)}</div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{simpleKindLabel(item.kind)}</div>
        </div>
        <Button
          variant="primary"
          onClick={(event) => {
            event.stopPropagation()
            onToggle(item)
          }}
          className="px-4 py-2 text-sm"
        >
          {actionLabel(item)}
        </Button>
        <Button
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation()
            onEdit(item)
          }}
          aria-label="Edit item"
        >
          Edit
        </Button>
      </div>
    </div>
  )
}

function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [loading, setLoading] = useState(true)
  const [cloudSync, setCloudSync] = useState<CloudSyncSnapshot>(getSyncStatus())
  const [authSession, setAuthSession] = useState<Session | null | undefined>(
    syncConfiguration.enabled && !isDesktopRuntime() ? undefined : null,
  )
  const [pendingInviteToken, setPendingInviteToken] = useState(() => (
    !isDesktopRuntime() ? new URLSearchParams(window.location.search).get('invite') ?? '' : ''
  ))
  const [activeSection, setActiveSection] = useState<SectionKey>('dashboard')
  const [weekReferenceDate, setWeekReferenceDate] = useState(new Date())
  const [calendarMonth, setCalendarMonth] = useState(new Date())
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('month')
  const [plannerMonth, setPlannerMonth] = useState(new Date())
  const [plannerCycleOverride, setPlannerCycleOverride] = useState<PlannerCycle | null>(null)
  const [plannerSelectedItem, setPlannerSelectedItem] = useState<SimpleItem | null>(null)
  const [plannerMove, setPlannerMove] = useState<PlannerMoveState | null>(null)
  const [plannerAmount, setPlannerAmount] = useState<PlannerAmountState | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [transactionModal, setTransactionModal] = useState<TransactionModalState | null>(null)
  const [ruleModal, setRuleModal] = useState<RuleModalState | null>(null)
  const [goalModal, setGoalModal] = useState<GoalModalState | null>(null)
  const [billFilter, setBillFilter] = useState<BillFilter>('all')
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all')
  const [recurringTab, setRecurringTab] = useState<RecurringTab>('income')
  const [selectedBillIds, setSelectedBillIds] = useState<Set<string>>(() => new Set())
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<string>>(() => new Set())
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [compactDashboard, setCompactDashboard] = useState(false)
  const [mobileLayout, setMobileLayout] = useState(() => window.matchMedia('(max-width: 1023px)').matches)
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('week')
  const [reportReferenceDate, setReportReferenceDate] = useState(new Date())
  const [reportStart, setReportStart] = useState(todayIso())
  const [reportEnd, setReportEnd] = useState(todayIso())
  const [reportTitle, setReportTitle] = useState('HomeCoin household report')
  const [showReportFilters, setShowReportFilters] = useState(false)
  const [showReportActions, setShowReportActions] = useState(false)
  const [onboarding, setOnboarding] = useState<OnboardingDraft>(emptyOnboardingDraft())
  const [onboardingStep, setOnboardingStep] = useState(0)
  const [newMemberName, setNewMemberName] = useState('')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryKind, setNewCategoryKind] = useState<'expense' | 'income'>('expense')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const stateRef = useRef<AppState | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const stored = await loadState()
        const cleanup = cleanupOneOffRecurringDuplicates(stored ?? createBlankState())
        const next = ensureCalculatedState(cleanup.state)
        if (cleanup.removed.length) {
          console.info(`[HomeCoin] Removed ${cleanup.removed.length} duplicate one-off ${cleanup.removed.length === 1 ? 'entry' : 'entries'} that matched recurring rules.`)
          await saveState(next)
        }
        setState(next)
        setWeekReferenceDate(new Date())
        setCalendarMonth(new Date())
        setPlannerMonth(new Date())
      } catch (error) {
        console.error('Failed to load HomeCoin state, using a blank household.', error)
        setState(ensureCalculatedState(createBlankState()))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (!state) {
      return
    }

    setDocumentTheme(state.settings.theme)
  }, [state])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    registerSyncedStateListener((syncedState) => {
      stateRef.current = syncedState
      setState(syncedState)
    })
    return () => registerSyncedStateListener(null)
  }, [])

  useEffect(() => subscribeSyncStatus(setCloudSync), [])

  useEffect(() => {
    if (!syncConfiguration.enabled || isDesktopRuntime()) return

    const auth = new AuthService(getSupabaseClient())
    let cancelled = false
    const updateSession = (session: Session | null) => {
      if (!cancelled) setAuthSession(session)
    }

    void auth.session().then(updateSession).catch(() => updateSession(null))
    const unsubscribe = auth.onAuthStateChange((_event, session) => updateSession(session))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!syncConfiguration.enabled || isDesktopRuntime() || loading || authSession === undefined || pendingInviteToken) return
    if (!authSession) {
      deactivateSyncRuntime()
      return
    }
    const client = getSupabaseClient()
    if (!client) return
    void restoreActiveSyncRuntime(client).catch((error) => console.error('Failed to restore the active shared household.', error))
  }, [authSession, loading, pendingInviteToken])

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)')
    const layoutMedia = window.matchMedia('(max-width: 1023px)')
    const syncDashboardDensity = () => setCompactDashboard(media.matches)
    const syncLayout = () => setMobileLayout(layoutMedia.matches)
    syncDashboardDensity()
    syncLayout()
    media.addEventListener('change', syncDashboardDensity)
    layoutMedia.addEventListener('change', syncLayout)
    return () => {
      media.removeEventListener('change', syncDashboardDensity)
      layoutMedia.removeEventListener('change', syncLayout)
    }
  }, [])

  const commit = async (mutator: (draft: AppState) => AppState) => {
    const current = stateRef.current
    if (!current) {
      return
    }

    const next = ensureCalculatedState(mutator(structuredClone(current)))
    const persisted = await saveState(next)
    stateRef.current = persisted
    setState(persisted)
    await enqueueSyncChanges(current, persisted)
  }

  const showToast = (message: string, undo?: () => Promise<void>) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ message, undo })
    toastTimerRef.current = setTimeout(() => setToast(null), 8_000)
  }

  const closeTransactionModal = () => setTransactionModal(null)
  const closeRuleModal = () => setRuleModal(null)
  const closeGoalModal = () => setGoalModal(null)

  const openAddTransaction = useCallback((kind?: SimpleKind) => {
    if (!state) {
      return
    }

    const defaultKind = kind ?? 'bill'
    setTransactionModal({
      phase: 'choose',
      source: 'new',
      editScope: 'occurrence',
      allowRecurrence: true,
      draft: defaultTransactionDraft(state, defaultKind, todayIso()),
    })
  }, [state])

  const openQuickTransaction = useCallback((kind: SimpleKind, title: string) => {
    if (!state) {
      return
    }

    setShowQuickAdd(false)
    setTransactionModal({
      phase: 'form',
      source: 'new',
      editScope: 'occurrence',
      allowRecurrence: true,
      draft: {
        ...defaultTransactionDraft(state, kind, todayIso()),
        title,
      },
    })
  }, [state])

  useEffect(() => {
    let navigationPrefix = false
    const routes: Record<string, SectionKey> = {
      d: 'dashboard',
      p: 'planner',
      w: 'week',
      m: 'calendar',
      r: 'recurring',
      b: 'bills',
      s: 'savings',
    }

    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if ((target instanceof Element && target.matches('input, textarea, select, [contenteditable="true"]')) || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      const key = event.key.toLowerCase()
      if (navigationPrefix && routes[key]) {
        event.preventDefault()
        setActiveSection(routes[key])
        navigationPrefix = false
        return
      }

      navigationPrefix = key === 'g'
      if (key === 'n') {
        event.preventDefault()
        openAddTransaction()
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [openAddTransaction])

  useEffect(() => {
    const closeDialogsOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDeleteDialog(null)
        setPlannerSelectedItem(null)
        setPlannerMove(null)
        setPlannerAmount(null)
      }
    }
    window.addEventListener('keydown', closeDialogsOnEscape)
    return () => window.removeEventListener('keydown', closeDialogsOnEscape)
  }, [])

  const openEditTransaction = (item: SimpleItem) => {
    if (!state) {
      return
    }

    const transaction = item.transactionId ? state.transactions.find((entry) => entry.id === item.transactionId) : null
    const linkedRule = item.recurrenceRuleId ? state.recurringRules.find((entry) => entry.id === item.recurrenceRuleId) : null
    const categoryId = transaction?.categoryId ?? item.categoryId ?? defaultCategoryId(state, item.kind)

    setTransactionModal({
      phase: 'form',
      source: linkedRule ? 'recurring' : 'transaction',
      editScope: 'occurrence',
      transactionId: transaction?.id,
      linkedRuleId: item.recurrenceRuleId,
      occurrenceDate: transaction?.transactionDate ?? item.date,
      allowRecurrence: false,
      draft: {
        kind: item.kind,
        title: transaction?.title ?? item.title,
        amount: String((transaction?.amountCents ?? item.amountCents) / 100),
        date: transaction?.dueDate ?? transaction?.transactionDate ?? item.date,
        recurrence: linkedRule ? recurrenceChoiceFromFrequency(linkedRule.frequency) : 'once',
        categoryId,
        accountId: transaction?.accountId ?? linkedRule?.accountId ?? defaultAccountId(state),
        personId: transaction?.personId ?? linkedRule?.personId ?? item.personId ?? '',
        notes: transaction?.notes ?? linkedRule?.notes ?? item.notes ?? '',
      },
    })
  }

  const openRuleModal = (rule?: RecurringRule) => {
    if (!state) {
      return
    }

    const category = rule ? state.categories.find((entry) => entry.id === rule.categoryId) : undefined
    setRuleModal({
      ruleId: rule?.id,
      draft: {
        kind: rule ? (['Income', 'Receitas'].includes(category?.group ?? '') ? 'income' : 'bill') : 'bill',
        name: rule?.name ?? 'Recurring bill',
        amount: String((rule?.amountCents ?? 0) / 100),
        frequency: rule?.frequency === 'weekly' || rule?.frequency === 'fortnightly' || rule?.frequency === 'yearly' ? (rule.frequency as RuleDraft['frequency']) : 'monthly',
        nextDueDate: rule?.nextDueDate ?? todayIso(),
        categoryId: rule?.categoryId ?? defaultCategoryId(state, 'bill'),
        accountId: rule?.accountId ?? defaultAccountId(state),
        personId: rule?.personId ?? defaultPersonId(state),
        notes: rule?.notes ?? '',
        active: rule?.active ?? true,
      },
    })
  }

  const saveTransaction = async () => {
    if (!state || !transactionModal) {
      return
    }

    const amountCents = parseMoney(transactionModal.draft.amount)
    if (!transactionModal.draft.title.trim() || amountCents <= 0 || !transactionModal.draft.accountId) {
      return
    }

    const currentState = stateRef.current ?? state
    const name = transactionModal.draft.title.trim()
    const date = transactionModal.draft.date

    if (transactionModal.source === 'recurring' && transactionModal.editScope === 'series' && transactionModal.linkedRuleId) {
      const existingRule = currentState.recurringRules.find((rule) => rule.id === transactionModal.linkedRuleId)
      if (!existingRule) {
        showToast('Recurring series not found')
        return
      }

      const categoryId = transactionModal.draft.categoryId || defaultCategoryId(currentState, transactionModal.draft.kind)
      const updatedRule: RecurringRule = {
        ...existingRule,
        name,
        amountCents,
        frequency: transactionModal.draft.recurrence === 'once'
          ? existingRule.frequency
          : RECURRENCE_TO_FREQUENCY[transactionModal.draft.recurrence],
        nextDueDate: date,
        accountId: transactionModal.draft.accountId,
        categoryId,
        personId: transactionModal.draft.personId || undefined,
        notes: transactionModal.draft.notes.trim(),
      }
      const seriesStart = transactionModal.occurrenceDate ?? existingRule.nextDueDate

      await commit((draft) => ({
        ...draft,
        recurringRules: draft.recurringRules.map((rule) => rule.id === existingRule.id ? updatedRule : rule),
        transactions: draft.transactions.filter((transaction) => {
          const isFutureSeriesOverride =
            transaction.recurrenceRuleId === existingRule.id &&
            transaction.transactionDate >= seriesStart &&
            !['paid', 'received'].includes(transaction.status)
          return !isFutureSeriesOverride
        }),
      }))
      showToast('Recurring series updated')
      closeTransactionModal()
      return
    }

    const createsRecurringRule =
      transactionModal.source === 'new' &&
      transactionModal.allowRecurrence &&
      transactionModal.draft.recurrence !== 'once'

    if (createsRecurringRule) {
      const duplicateRule = currentState.recurringRules.some((rule) => isSameRecurringEntry(name, amountCents, date, rule))
      const duplicateTransaction = currentState.transactions.some((transaction) => isSamePlannedEntry(name, amountCents, date, transaction))
      if (duplicateRule || duplicateTransaction) {
        console.warn('[HomeCoin] Skipped a duplicate recurring entry.')
        showToast('Duplicate skipped')
        return
      }

      const recurringRule: RecurringRule = {
        id: crypto.randomUUID(),
        householdId: currentState.household.id,
        name,
        amountCents,
        frequency: RECURRENCE_TO_FREQUENCY[transactionModal.draft.recurrence as Exclude<RecurrenceChoice, 'once'>],
        interval: 1,
        nextDueDate: date,
        accountId: transactionModal.draft.accountId,
        categoryId: transactionModal.draft.categoryId || defaultCategoryId(currentState, transactionModal.draft.kind),
        personId: transactionModal.draft.personId || undefined,
        generateAutomatically: true,
        reminder: true,
        endDate: undefined,
        active: true,
        notes: transactionModal.draft.notes.trim(),
      }

      await commit((draft) => ({ ...draft, recurringRules: [recurringRule, ...draft.recurringRules] }))
      showToast(transactionModal.draft.kind === 'income' ? 'Recurring income added' : 'Recurring bill added')
      closeTransactionModal()
      return
    }

    if (transactionModal.source === 'new' && !transactionModal.transactionId) {
      const duplicateTransaction = currentState.transactions.some((transaction) => isSamePlannedEntry(name, amountCents, date, transaction))
      const duplicateRule = currentState.recurringRules.some((rule) => isSameRecurringEntry(name, amountCents, date, rule))
      if (duplicateTransaction || duplicateRule) {
        console.warn('[HomeCoin] Skipped a duplicate one-off entry.')
        showToast('Duplicate skipped')
        return
      }
    }

    const now = new Date().toISOString()
    const baseTransaction: Transaction = {
      id: transactionModal.transactionId ?? crypto.randomUUID(),
      householdId: currentState.household.id,
      title: name,
      description: name,
      amountCents,
      type: transactionModal.draft.kind === 'income' ? 'income' : 'expense',
      categoryId: transactionModal.draft.categoryId || defaultCategoryId(currentState, transactionModal.draft.kind),
      accountId: transactionModal.draft.accountId,
      transactionDate: transactionModal.source === 'recurring'
        ? transactionModal.occurrenceDate ?? transactionModal.draft.date
        : transactionModal.draft.date,
      dueDate: transactionModal.draft.date,
      paidDate: transactionModal.transactionId ? currentState.transactions.find((entry) => entry.id === transactionModal.transactionId)?.paidDate : undefined,
      status: transactionModal.transactionId
        ? currentState.transactions.find((entry) => entry.id === transactionModal.transactionId)?.status ?? 'planned'
        : 'planned',
      personId: transactionModal.draft.personId || undefined,
      payee: transactionModal.draft.personId || undefined,
      paymentMethod: 'Local',
      recurrenceRuleId: transactionModal.linkedRuleId,
      notes: transactionModal.draft.notes.trim(),
      receiptUrl: undefined,
      source: 'manual',
      splits: [],
      tags: [],
      createdAt: now,
      updatedAt: now,
    }

    await commit((draft) => ({
      ...draft,
      transactions: transactionModal.transactionId
        ? draft.transactions.map((entry) => (entry.id === transactionModal.transactionId ? { ...entry, ...baseTransaction } : entry))
        : [baseTransaction, ...draft.transactions],
    }))
    showToast(
      transactionModal.source === 'recurring'
        ? 'Occurrence updated'
        : transactionModal.transactionId
          ? 'Item updated'
          : transactionModal.draft.kind === 'income' ? 'Income added' : 'Bill added',
    )
    closeTransactionModal()
  }

  const completeItem = async (item: SimpleItem) => {
    if (!state) {
      return
    }

    const completedStatus = item.kind === 'income' ? 'received' : 'paid'
    const existing = item.transactionId ? state.transactions.find((entry) => entry.id === item.transactionId) : null

    if (existing) {
      await commit((draft) => ({
        ...draft,
        transactions: draft.transactions.map((entry) =>
          entry.id === existing.id
            ? {
                ...entry,
                status: completedStatus,
                paidDate: item.date,
                updatedAt: new Date().toISOString(),
              }
            : entry,
        ),
      }))
      return
    }

    const created: Transaction = {
      id: crypto.randomUUID(),
      householdId: state.household.id,
      title: item.title,
      description: item.title,
      amountCents: item.amountCents,
      type: item.kind === 'income' ? 'income' : 'expense',
      categoryId: item.categoryId,
      accountId: defaultAccountId(state),
      transactionDate: item.date,
      dueDate: item.date,
      paidDate: item.date,
      status: completedStatus,
      personId: item.personId,
      payee: item.personId,
      paymentMethod: 'Local',
      recurrenceRuleId: item.recurrenceRuleId,
      notes: item.notes ?? '',
      receiptUrl: undefined,
      source: 'manual',
      splits: [],
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await commit((draft) => ({
      ...draft,
      transactions: [created, ...draft.transactions],
    }))
  }

  const openAddTransactionForDate = (date: string, kind: SimpleKind = 'bill') => {
    if (!state) return
    setTransactionModal({
      phase: 'form',
      source: 'new',
      editScope: 'occurrence',
      allowRecurrence: true,
      draft: defaultTransactionDraft(state, kind, date),
    })
  }

  const applyPlannerMutation = async (mutator: (draft: AppState) => AppState, message: string) => {
    const current = stateRef.current
    if (!current) return
    const previous = structuredClone(current)
    await commit(mutator)
    showToast(message, async () => {
      await commit(() => previous)
      showToast('Planner change undone')
    })
  }

  const requestPlannerMove = (item: SimpleItem, targetDate: string) => {
    if (isCompletedPlannerItem(item)) {
      showToast('Completed items can be changed from Edit.')
      return
    }
    if (item.recurrenceRuleId) {
      setPlannerMove({ item, targetDate, scope: 'occurrence' })
      return
    }
    void applyPlannerMutation(
      (draft) => moveOneOffPlannerItem(draft, item, targetDate, new Date().toISOString()),
      `Moved ${item.title} to ${formatSimpleDay(targetDate, state?.settings.locale ?? 'en-IE')}`,
    )
  }

  const openPlannerMove = (item: SimpleItem) => {
    if (isCompletedPlannerItem(item)) {
      showToast('Completed items can be changed from Edit.')
      return
    }
    setPlannerMove({ item, targetDate: item.date, scope: 'occurrence' })
  }

  const confirmPlannerMove = async () => {
    const current = stateRef.current
    if (!current || !plannerMove) return
    const { item, targetDate, scope } = plannerMove
    const rule = item.recurrenceRuleId
      ? current.recurringRules.find((entry) => entry.id === item.recurrenceRuleId)
      : undefined
    if (item.recurrenceRuleId && !rule) {
      showToast('Recurring series not found')
      return
    }
    const now = new Date().toISOString()
    await applyPlannerMutation(
      (draft) => {
        if (!rule) return moveOneOffPlannerItem(draft, item, targetDate, now)
        return scope === 'occurrence'
          ? upsertPlannerOccurrenceOverride(draft, item, rule, { targetDate, id: crypto.randomUUID(), now })
          : updatePlannerSeriesFromOccurrence(draft, item, rule, { nextDueDate: targetDate, updatedAt: now })
      },
      scope === 'occurrence' ? 'Occurrence moved' : 'This and following occurrences moved',
    )
    setPlannerMove(null)
    setPlannerSelectedItem(null)
  }

  const confirmPlannerAmount = async () => {
    const current = stateRef.current
    if (!current || !plannerAmount) return
    const amountCents = parseMoney(plannerAmount.amount)
    if (amountCents <= 0) {
      showToast('Enter an amount greater than zero')
      return
    }
    const { item, scope } = plannerAmount
    const rule = item.recurrenceRuleId
      ? current.recurringRules.find((entry) => entry.id === item.recurrenceRuleId)
      : undefined
    const now = new Date().toISOString()
    await applyPlannerMutation((draft) => {
      if (!rule) return updateOneOffPlannerAmount(draft, item, amountCents, now)
      return scope === 'occurrence'
        ? upsertPlannerOccurrenceOverride(draft, item, rule, { targetDate: item.date, amountCents, id: crypto.randomUUID(), now })
        : updatePlannerSeriesFromOccurrence(draft, item, rule, { amountCents, updatedAt: now })
    }, scope === 'occurrence' ? 'Amount updated' : 'This and following amounts updated')
    setPlannerAmount(null)
    setPlannerSelectedItem(null)
  }

  const completeItemFromPlanner = async (item: SimpleItem) => {
    await applyPlannerMutation(
      (draft) => completePlannerItem(draft, item, crypto.randomUUID(), new Date().toISOString()),
      item.kind === 'income' ? 'Income received' : 'Bill paid',
    )
    setPlannerSelectedItem(null)
  }

  const openSettingsFilePicker = () => fileInputRef.current?.click()

  const exportBackup = async () => {
    if (!state) {
      return
    }

    try {
      const payload = await serializeBackup(state)
      const fileName = `homecoin-backup-${todayIso()}.json`
      const folder = 'HomeCoin/Backups'
      const relativePath = `${folder}/${fileName}`
      const selectedPath = `Documents/${relativePath}`

      if (!isDesktopRuntime()) {
        const blob = new Blob([payload], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = fileName
        anchor.click()
        URL.revokeObjectURL(url)
        return
      }

      await mkdir(folder, { baseDir: BaseDirectory.Document, recursive: true })
      await writeTextFile(relativePath, payload, { baseDir: BaseDirectory.Document })

      const parsed = JSON.parse(payload)
      if (await validateBackupPayload(parsed)) {
        const record = createBackupRecord(fileName, selectedPath, parsed.checksum, parsed.schemaVersion, 'Backup local exportado.')
        await recordBackup(record)
        await commit((draft) => ({
          ...draft,
          backups: [record, ...draft.backups],
          settings: {
            ...draft.settings,
            lastBackupAt: record.createdAt,
            backupDirectory: 'Documents/HomeCoin/Backups',
          },
        }))
      }
    } catch (error) {
      console.error('Backup export failed.', error)
      window.alert('The backup could not be exported.')
    }
  }

  const importBackup = async (file: File) => {
    if (!state) {
      return
    }

    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (!(await validateBackupPayload(parsed))) {
        window.alert('This backup is invalid or corrupted.')
        return
      }

      const next = ensureCalculatedState(parsed.state as AppState)
      const previous = stateRef.current
      const persisted = await saveState(next)
      stateRef.current = persisted
      setState(persisted)
      if (previous) await enqueueSyncChanges(previous, persisted)
      setShowSettings(false)
    } catch (error) {
      console.error('Backup import failed.', error)
      window.alert('The backup could not be imported.')
    }
  }

  const handleTransactionFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      await importBackup(file)
    }
    event.target.value = ''
  }

  const saveRule = async () => {
    if (!state || !ruleModal) {
      return
    }

    const amountCents = parseMoney(ruleModal.draft.amount)
    if (!ruleModal.draft.name.trim() || amountCents <= 0) {
      return
    }

    if (!ruleModal.ruleId) {
      const currentState = stateRef.current ?? state
      const name = ruleModal.draft.name.trim()
      const date = ruleModal.draft.nextDueDate
      const duplicateRule = currentState.recurringRules.some((rule) => isSameRecurringEntry(name, amountCents, date, rule))
      const duplicateTransaction = currentState.transactions.some((transaction) => isSamePlannedEntry(name, amountCents, date, transaction))
      if (duplicateRule || duplicateTransaction) {
        console.warn('[HomeCoin] Skipped a duplicate recurring item from the Recurring page.')
        showToast('Duplicate skipped')
        return
      }
    }

    const rule: RecurringRule = {
      id: ruleModal.ruleId ?? crypto.randomUUID(),
      householdId: state.household.id,
      name: ruleModal.draft.name.trim(),
      amountCents,
      frequency: RECURRENCE_TO_FREQUENCY[ruleModal.draft.frequency],
      interval: 1,
      nextDueDate: ruleModal.draft.nextDueDate,
      accountId: ruleModal.draft.accountId,
      categoryId: ruleModal.draft.categoryId || defaultCategoryId(state, ruleModal.draft.kind),
      personId: ruleModal.draft.personId || undefined,
      generateAutomatically: true,
      reminder: true,
      endDate: undefined,
      active: ruleModal.draft.active,
    }

    await commit((draft) => ({
      ...draft,
      recurringRules: ruleModal.ruleId
        ? draft.recurringRules.map((entry) => (entry.id === ruleModal.ruleId ? rule : entry))
        : [rule, ...draft.recurringRules],
    }))

    showToast(ruleModal.ruleId ? 'Recurring item updated' : ruleModal.draft.kind === 'income' ? 'Recurring income added' : 'Recurring expense added')
    closeRuleModal()
  }

  const duplicateRule = async (rule: RecurringRule) => {
    if (!state) {
      return
    }

    await commit((draft) => ({
      ...draft,
      recurringRules: [
        {
          ...rule,
          id: crypto.randomUUID(),
          name: `${rule.name} (copy)`,
          active: rule.active,
        },
        ...draft.recurringRules,
      ],
    }))
  }

  const toggleRuleActive = async (rule: RecurringRule) => {
    await commit((draft) => ({
      ...draft,
      recurringRules: draft.recurringRules.map((entry) => (entry.id === rule.id ? { ...entry, active: !entry.active } : entry)),
    }))
  }

  const deleteRule = (rule: RecurringRule) => setDeleteDialog({ kind: 'recurring', rules: [rule] })

  const toggleSelection = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setter((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const confirmDelete = async () => {
    const current = stateRef.current
    if (!current || !deleteDialog) return

    if (deleteDialog.kind === 'bills') {
      const existingById = new Map<string, Transaction>()
      const tombstones: Transaction[] = []
      const now = new Date().toISOString()

      for (const item of deleteDialog.items) {
        const existing = item.transactionId ? current.transactions.find((transaction) => transaction.id === item.transactionId) : undefined
        if (existing) {
          existingById.set(existing.id, structuredClone(existing))
          continue
        }

        tombstones.push({
          id: crypto.randomUUID(),
          householdId: current.household.id,
          title: item.title,
          description: item.title,
          amountCents: item.amountCents,
          type: item.kind === 'income' ? 'income' : 'expense',
          categoryId: item.categoryId,
          accountId: defaultAccountId(current),
          transactionDate: item.date,
          dueDate: item.date,
          status: 'cancelled',
          personId: item.personId,
          recurrenceRuleId: item.recurrenceRuleId,
          notes: item.notes ?? '',
          source: 'manual',
          splits: [],
          tags: [],
          createdAt: now,
          updatedAt: now,
          cancelledAt: now,
        })
      }

      await commit((draft) => ({
        ...draft,
        transactions: [
          ...tombstones,
          ...draft.transactions.map((transaction) => existingById.has(transaction.id)
            ? { ...transaction, status: 'cancelled' as const, cancelledAt: now, updatedAt: now }
            : transaction),
        ],
      }))

      const restoredTransactions = [...existingById.values()]
      const tombstoneIds = new Set(tombstones.map((transaction) => transaction.id))
      showToast(deleteDialog.items.length === 1 ? 'Bill deleted' : `${deleteDialog.items.length} bills deleted`, async () => {
        await commit((draft) => ({
          ...draft,
          transactions: draft.transactions
            .filter((transaction) => !tombstoneIds.has(transaction.id))
            .map((transaction) => restoredTransactions.find((restored) => restored.id === transaction.id) ?? transaction),
        }))
        showToast(deleteDialog.items.length === 1 ? 'Bill restored' : 'Bills restored')
      })
      setSelectedBillIds(new Set())
    } else {
      const deletedRules = deleteDialog.rules.map((rule) => structuredClone(rule))
      const ruleIds = new Set(deletedRules.map((rule) => rule.id))
      const removedFutureTransactions = current.transactions.filter((transaction) =>
        Boolean(transaction.recurrenceRuleId && ruleIds.has(transaction.recurrenceRuleId)) &&
        transaction.transactionDate > todayIso() &&
        ['planned', 'pending', 'overdue'].includes(transaction.status),
      ).map((transaction) => structuredClone(transaction))
      const removedTransactionIds = new Set(removedFutureTransactions.map((transaction) => transaction.id))

      await commit((draft) => ({
        ...draft,
        recurringRules: draft.recurringRules.filter((rule) => !ruleIds.has(rule.id)),
        transactions: draft.transactions.filter((transaction) => !removedTransactionIds.has(transaction.id)),
      }))

      showToast(deletedRules.length === 1 ? 'Recurring item deleted' : `${deletedRules.length} recurring items deleted`, async () => {
        await commit((draft) => ({
          ...draft,
          recurringRules: [...deletedRules.filter((rule) => !draft.recurringRules.some((entry) => entry.id === rule.id)), ...draft.recurringRules],
          transactions: [...removedFutureTransactions.filter((transaction) => !draft.transactions.some((entry) => entry.id === transaction.id)), ...draft.transactions],
        }))
        showToast(deletedRules.length === 1 ? 'Recurring item restored' : 'Recurring items restored')
      })
      setSelectedRuleIds(new Set())
    }

    setDeleteDialog(null)
  }

  const openGoalModal = (goal?: FinancialGoal, contributionOnly = false) => {
    setGoalModal({
      goalId: goal?.id,
      contributionOnly,
      draft: {
        name: goal?.name ?? '',
        targetAmount: goal ? String(goal.targetCents / 100) : '',
        currentAmount: contributionOnly ? '' : goal ? String(goal.currentCents / 100) : '0',
        monthlyContribution: goal ? String(goal.monthlyContributionCents / 100) : '',
        targetDate: goal?.targetDate ?? '',
        notes: goal?.notes ?? '',
      },
    })
  }

  const saveGoal = async () => {
    if (!state || !goalModal) {
      return
    }

    const existing = goalModal.goalId ? state.goals.find((goal) => goal.id === goalModal.goalId) : undefined

    if (goalModal.contributionOnly && existing) {
      const contributionCents = parseMoney(goalModal.draft.currentAmount)
      const acceptedContributionCents = Math.min(contributionCents, Math.max(0, existing.targetCents - existing.currentCents))
      if (acceptedContributionCents <= 0) {
        return
      }

      const targetAccountId = existing.accountId ?? state.accounts.find((account) => account.type === 'savings')?.id
      const sourceAccountId = state.accounts.find((account) => !account.archived && account.id !== targetAccountId && account.type !== 'savings')?.id ?? defaultAccountId(state)
      const transferCategoryId = state.categories.find((category) => ['Transfers', 'Movimento'].includes(category.group))?.id ?? defaultCategoryId(state, 'bill')
      const now = new Date().toISOString()
      const contribution: Transaction = {
        id: crypto.randomUUID(),
        householdId: state.household.id,
        title: `Savings: ${existing.name}`,
        description: `Contribution to ${existing.name}`,
        amountCents: acceptedContributionCents,
        type: 'transfer',
        categoryId: transferCategoryId,
        accountId: sourceAccountId,
        counterpartyAccountId: targetAccountId,
        transactionDate: todayIso(),
        dueDate: todayIso(),
        paidDate: todayIso(),
        status: 'paid',
        paymentMethod: 'Savings contribution',
        tags: ['savings', `goal:${existing.id}`],
        notes: '',
        source: 'manual',
        splits: [],
        createdAt: now,
        updatedAt: now,
      }

      await commit((draft) => ({
        ...draft,
        transactions: [contribution, ...draft.transactions],
        goals: draft.goals.map((goal) =>
          goal.id === existing.id
            ? { ...goal, currentCents: goal.currentCents + acceptedContributionCents }
            : goal,
        ),
      }))
      closeGoalModal()
      return
    }

    const targetCents = parseMoney(goalModal.draft.targetAmount)
    if (!goalModal.draft.name.trim() || targetCents <= 0) {
      return
    }

    const goal: FinancialGoal = {
      id: existing?.id ?? crypto.randomUUID(),
      householdId: state.household.id,
      name: goalModal.draft.name.trim(),
      targetCents,
      currentCents: Math.min(targetCents, parseMoney(goalModal.draft.currentAmount)),
      monthlyContributionCents: parseMoney(goalModal.draft.monthlyContribution),
      targetDate: goalModal.draft.targetDate || undefined,
      accountId: existing?.accountId ?? state.accounts.find((account) => account.type === 'savings')?.id,
      priority: existing?.priority ?? state.goals.length + 1,
      notes: goalModal.draft.notes.trim(),
      archived: false,
    }

    await commit((draft) => ({
      ...draft,
      goals: existing
        ? draft.goals.map((entry) => (entry.id === existing.id ? goal : entry))
        : [...draft.goals, goal],
    }))
    closeGoalModal()
  }

  const deleteGoal = async (goal: FinancialGoal) => {
    if (!window.confirm(`Delete the savings goal "${goal.name}"?`)) {
      return
    }

    await commit((draft) => ({
      ...draft,
      goals: draft.goals.filter((entry) => entry.id !== goal.id),
    }))
  }

  const addMember = async () => {
    if (!state || !newMemberName.trim()) {
      return
    }

    const member: HouseholdMember = {
      id: crypto.randomUUID(),
      householdId: state.household.id,
      name: newMemberName.trim(),
      role: 'Household member',
      color: '#2c7f70',
      active: true,
    }

    await commit((draft) => ({
      ...draft,
      members: [member, ...draft.members],
    }))
    setNewMemberName('')
  }

  const removeMember = async (member: HouseholdMember) => {
    if (!window.confirm(`Remove "${member.name}"?`)) {
      return
    }

    await commit((draft) => ({
      ...draft,
      members: draft.members.filter((entry) => entry.id !== member.id),
    }))
  }

  const addCategory = async () => {
    if (!state || !newCategoryName.trim()) {
      return
    }

    await commit((draft) => ({
      ...draft,
      categories: [
        ...draft.categories,
        {
          id: crypto.randomUUID(),
          householdId: draft.household.id,
          name: newCategoryName.trim(),
          group: newCategoryKind === 'income' ? 'Income' : 'Household',
          order: draft.categories.length,
          archived: false,
          color: newCategoryKind === 'income' ? '#2F7D5B' : '#4A6FA5',
          icon: newCategoryKind === 'income' ? 'CircleDollarSign' : 'ReceiptText',
        },
      ],
    }))
    setNewCategoryName('')
  }

  const toggleCategory = async (categoryId: string) => {
    await commit((draft) => ({
      ...draft,
      categories: draft.categories.map((category) => category.id === categoryId ? { ...category, archived: !category.archived } : category),
    }))
  }

  const togglePrivacy = async () => {
    if (!state) {
      return
    }

    await commit((draft) => ({
      ...draft,
      settings: {
        ...draft.settings,
        privacyMode: !draft.settings.privacyMode,
        hideSensitiveValues: !draft.settings.hideSensitiveValues,
      },
    }))
  }

  const applyTheme = async (theme: ThemeMode) => {
    if (!state) {
      return
    }

    await commit((draft) => ({
      ...draft,
      settings: {
        ...draft.settings,
        theme,
      },
    }))
  }

  const loadSampleHousehold = async () => {
    const previous = stateRef.current
    const sample = ensureCalculatedState(createDemoState())
    const persisted = await saveState(sample)
    stateRef.current = persisted
    setState(persisted)
    if (previous) await enqueueSyncChanges(previous, persisted)
    setActiveSection('dashboard')
  }

  const handleOnboardingSubmit = async () => {
    const base = ensureCalculatedState(createBlankState())
    const accountId = crypto.randomUUID()
    const household = {
      ...base.household,
      currency: onboarding.currency,
      weekStartDay: onboarding.weekStartDay,
      locale: 'en-US',
    }

    const next: AppState = {
      ...base,
      onboardingCompleted: true,
      household,
      accounts: [
        {
          id: accountId,
          householdId: household.id,
          name: 'Main account',
          institution: 'Local',
          type: 'current',
          currency: onboarding.currency,
          openingBalanceCents: parseMoney(onboarding.currentBalance),
          currentBalanceCents: parseMoney(onboarding.currentBalance),
          holder: 'Household',
          accentColor: '#2c7f70',
          archived: false,
          notes: '',
        },
      ],
      settings: {
        ...base.settings,
        currency: onboarding.currency,
        locale: 'en-US',
        weekStartDay: onboarding.weekStartDay,
        financialMonthStartDay: 1,
        theme: 'light',
      },
    }

    if (onboarding.addStarterItems) {
      const now = todayIso()
      next.transactions = [
        {
          id: crypto.randomUUID(),
          householdId: household.id,
          title: onboarding.salaryName.trim() || 'Salary',
          description: onboarding.salaryName.trim() || 'Salary',
          amountCents: parseMoney(onboarding.salaryAmount),
          type: 'income',
          categoryId: defaultCategoryId(next, 'income'),
          accountId,
          transactionDate: now,
          dueDate: now,
          paidDate: undefined,
          status: 'planned',
          personId: undefined,
          payee: undefined,
          paymentMethod: 'Local',
          recurrenceRuleId: undefined,
          notes: '',
          receiptUrl: undefined,
          source: 'manual',
          splits: [],
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: crypto.randomUUID(),
          householdId: household.id,
          title: onboarding.billName.trim() || 'First bill',
          description: onboarding.billName.trim() || 'First bill',
          amountCents: parseMoney(onboarding.billAmount),
          type: 'expense',
          categoryId: defaultCategoryId(next, 'bill'),
          accountId,
          transactionDate: now,
          dueDate: now,
          paidDate: undefined,
          status: 'planned',
          personId: undefined,
          payee: undefined,
          paymentMethod: 'Local',
          recurrenceRuleId: undefined,
          notes: '',
          receiptUrl: undefined,
          source: 'manual',
          splits: [],
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]
    }

    const calculated = ensureCalculatedState(next)
    const persisted = await saveState(calculated)
    stateRef.current = persisted
    setState(persisted)
  }

  if (loading) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center px-4">
        <Card className="max-w-md p-8 text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-emerald-100" />
          <p className="mt-5 text-lg font-semibold text-slate-900">Preparing HomeCoin...</p>
          <p className="mt-2 text-sm text-slate-500">Loading your local data and building the week.</p>
        </Card>
      </div>
    )
  }

  if (!state) {
    return null
  }

  if (syncConfiguration.enabled && !isDesktopRuntime() && authSession === undefined) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center px-4">
        <Card className="max-w-md p-8 text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-emerald-100" />
          <p className="mt-5 text-lg font-semibold text-slate-900">Checking your account...</p>
          <p className="mt-2 text-sm text-slate-500">Loading the shared workspace before opening HomeCoin.</p>
        </Card>
      </div>
    )
  }

  if (syncConfiguration.enabled && !isDesktopRuntime() && authSession === null) {
    return (
      <div className="app-shell min-h-screen px-4 py-8">
        <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-3xl place-items-center">
          <Card className="w-full p-6 md:p-8">
            <div className="mb-6">
              <p className="text-sm font-semibold uppercase tracking-[0.26em] text-emerald-700">HomeCoin</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Sign in to continue</h1>
              <p className="mt-3 max-w-2xl text-slate-600">
                Cloud sync is enabled for this web/PWA session. Sign in to unlock the shared household and keep using HomeCoin normally.
              </p>
            </div>
            <Suspense fallback={<p>Loading sharing settings…</p>}><SharingPanel authOnly state={state} onStateChanged={(syncedState) => { stateRef.current = syncedState; setState(syncedState) }} /></Suspense>
          </Card>
        </div>
      </div>
    )
  }

  if (syncConfiguration.enabled && !isDesktopRuntime() && authSession && pendingInviteToken) {
    return (
      <div className="app-shell min-h-screen px-4 py-8">
        <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-3xl place-items-center">
          <Card className="w-full p-6 md:p-8">
            <div className="mb-6">
              <p className="text-sm font-semibold uppercase tracking-[0.26em] text-emerald-700">HomeCoin</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Accept invitation</h1>
              <p className="mt-3 max-w-2xl text-slate-600">Open the shared household before creating any local planning data.</p>
            </div>
            <Suspense fallback={<p>Loading invitation…</p>}>
              <SharingPanel
                inviteOnly
                initialInviteToken={pendingInviteToken}
                state={state}
                onStateChanged={(syncedState) => { stateRef.current = syncedState; setState(syncedState) }}
                onInviteAccepted={() => {
                  const url = new URL(window.location.href)
                  url.searchParams.delete('invite')
                  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
                  setPendingInviteToken('')
                }}
              />
            </Suspense>
          </Card>
        </div>
      </div>
    )
  }

  if (!state.onboardingCompleted || state.accounts.length === 0) {
    return (
      <div className="app-shell min-h-screen px-4 py-8">
        <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-5xl place-items-center">
          <Card className="w-full max-w-3xl p-6 md:p-8">
            <div className="mb-6">
              <p className="text-sm font-semibold uppercase tracking-[0.26em] text-emerald-700">HomeCoin</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Let's set up your household plan</h1>
              <p className="mt-3 max-w-2xl text-slate-600">
                Add the essentials in under two minutes. HomeCoin will show what comes in, what goes out, and what stays yours.
              </p>
            </div>

            <div className="onboarding-progress" aria-label={`Onboarding step ${onboardingStep + 1} of 4`}>
              {[0, 1, 2, 3].map((step) => <span key={step} data-active={step <= onboardingStep} />)}
            </div>

            <div className="onboarding-step" aria-live="polite">
              {onboardingStep === 0 ? <div>
                <p className="eyebrow">Step 1 of 4</p>
                <h2>Which currency do you use?</h2>
                <Field label="Currency">
                  <select className="select" value={onboarding.currency} onChange={(event) => setOnboarding((draft) => ({ ...draft, currency: event.target.value }))}>
                    {CURRENCY_OPTIONS.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                  </select>
                </Field>
              </div> : null}

              {onboardingStep === 1 ? <div>
                <p className="eyebrow">Step 2 of 4</p>
                <h2>When does your financial week begin?</h2>
                <Field label="First day of the week">
                  <select className="select" value={onboarding.weekStartDay} onChange={(event) => setOnboarding((draft) => ({ ...draft, weekStartDay: Number(event.target.value) }))}>
                    {WEEKDAY_OPTIONS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                  </select>
                </Field>
              </div> : null}

              {onboardingStep === 2 ? <div>
                <p className="eyebrow">Step 3 of 4</p>
                <h2>What is your available balance now?</h2>
                <Field label={`Current balance (${onboarding.currency})`}>
                  <input className="input" inputMode="decimal" value={onboarding.currentBalance} onChange={(event) => setOnboarding((draft) => ({ ...draft, currentBalance: event.target.value }))} placeholder="0.00" />
                </Field>
              </div> : null}

              {onboardingStep === 3 ? <div>
                <p className="eyebrow">Step 4 of 4</p>
                <h2>Would you like to add starter items?</h2>
                <label className="onboarding-choice">
                  <input type="checkbox" checked={onboarding.addStarterItems} onChange={(event) => setOnboarding((draft) => ({ ...draft, addStarterItems: event.target.checked }))} />
                  <span><strong>Add a salary and first bill</strong><small>Optional. You can add or edit everything later.</small></span>
                </label>
                {onboarding.addStarterItems ? <div className="onboarding-starter-grid">
                  <Card className="p-4"><p className="font-semibold text-slate-900">First income</p><div className="mt-4 grid gap-4">
                    <Field label="Name"><input className="input" value={onboarding.salaryName} onChange={(event) => setOnboarding((draft) => ({ ...draft, salaryName: event.target.value }))} /></Field>
                    <Field label="Amount"><input className="input" inputMode="decimal" value={onboarding.salaryAmount} onChange={(event) => setOnboarding((draft) => ({ ...draft, salaryAmount: event.target.value }))} /></Field>
                  </div></Card>
                  <Card className="p-4"><p className="font-semibold text-slate-900">First bill</p><div className="mt-4 grid gap-4">
                    <Field label="Name"><input className="input" value={onboarding.billName} onChange={(event) => setOnboarding((draft) => ({ ...draft, billName: event.target.value }))} /></Field>
                    <Field label="Amount"><input className="input" inputMode="decimal" value={onboarding.billAmount} onChange={(event) => setOnboarding((draft) => ({ ...draft, billAmount: event.target.value }))} /></Field>
                  </div></Card>
                </div> : null}
              </div> : null}
            </div>

            <div className="onboarding-actions">
              <Button variant="secondary" onClick={loadSampleHousehold}>Load sample data</Button>
              <div>
                {onboardingStep > 0 ? <Button variant="ghost" onClick={() => setOnboardingStep((step) => Math.max(0, step - 1))}>Back</Button> : null}
                {onboardingStep < 3 ? <Button variant="primary" onClick={() => setOnboardingStep((step) => Math.min(3, step + 1))}>Next</Button> : <Button variant="primary" onClick={handleOnboardingSubmit}>Start using HomeCoin</Button>}
              </div>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  const weekSnapshot = buildWeekSnapshot(state, weekReferenceDate)
  const weekBalanceProjection = buildRollingBalanceProjection(state, weekSnapshot.start, weekSnapshot.end, new Date())
  const nextWeeks = buildNextWeeks(state, weekReferenceDate, 4)
  const nextWeeksWithBalance = nextWeeks.map((week) => ({
    ...week,
    balance: buildRollingBalanceProjection(state, week.start, week.end, new Date()),
  }))
  const calendarSnapshot = buildMonthCalendar(state, calendarMonth, weekReferenceDate)
  const activeGoals = state.goals.filter((goal) => !goal.archived)
  const savedTotal = activeGoals.reduce((total, goal) => total + goal.currentCents, 0)
  const plannedMonthlySavings = activeGoals.reduce((total, goal) => total + goal.monthlyContributionCents, 0)
  const reportRange = (() => {
    if (reportPeriod === 'week') {
      return buildWeekSnapshot(state, reportReferenceDate)
    }

    if (reportPeriod === 'month') {
      return summarizeRange(state, toIsoDate(startOfMonth(reportReferenceDate)), toIsoDate(endOfMonth(reportReferenceDate)), reportReferenceDate)
    }

    if (reportPeriod === 'year') {
      return summarizeRange(state, toIsoDate(startOfYear(reportReferenceDate)), toIsoDate(endOfYear(reportReferenceDate)), reportReferenceDate)
    }

    return summarizeRange(state, reportStart, reportEnd, reportReferenceDate)
  })()

  const reportTrend = buildMonthlyTrend(state, 12, reportReferenceDate)
  const reportDistribution = buildCategoryDistribution(state, reportRange.start, reportRange.end, reportReferenceDate)
  const reportItems = buildVisibleItems(state, reportRange.start, reportRange.end, reportReferenceDate)
  const reportRangeDays = Math.max(1, Math.round((new Date(`${reportRange.end}T12:00:00`).getTime() - new Date(`${reportRange.start}T12:00:00`).getTime()) / 86_400_000) + 1)
  const reportPlannedSavings = reportPeriod === 'week'
    ? Math.round(plannedMonthlySavings * 12 / 52)
    : reportPeriod === 'month'
      ? plannedMonthlySavings
      : reportPeriod === 'year'
        ? plannedMonthlySavings * 12
        : Math.round(plannedMonthlySavings * 12 * reportRangeDays / 365)
  const savingsPlanForGoal = (monthlyContributionCents: number) => reportPeriod === 'week'
    ? Math.round(monthlyContributionCents * 12 / 52)
    : reportPeriod === 'month'
      ? monthlyContributionCents
      : reportPeriod === 'year'
        ? monthlyContributionCents * 12
        : Math.round(monthlyContributionCents * 12 * reportRangeDays / 365)
  const reportActualSavings = savingsContributedInRange(state, reportRange.start, reportRange.end)
  const reportSavingsStillPlanned = Math.max(0, reportPlannedSavings - reportActualSavings)
  const reportSavingsCashOutflow = Math.max(reportPlannedSavings, reportActualSavings)
  const reportAfterSavings = reportRange.remainingCents - reportSavingsCashOutflow
  const reportBalanceProjection = buildRollingBalanceProjection(state, reportRange.start, reportRange.end, new Date())
  const reportOpeningBalance = reportBalanceProjection.openingBalanceCents
  const reportPlanningRange = reportPeriod === 'week' || reportPeriod === 'month'
    ? expandPlanningRange(state, reportRange.start, reportRange.end)
    : null
  const plannerOpeningBalance = reportPlanningRange
    ? buildRollingBalanceProjection(state, reportPlanningRange.start, reportPlanningRange.end, new Date()).openingBalanceCents
    : reportOpeningBalance
  const planningWeeks = reportPeriod === 'week' || reportPeriod === 'month'
    ? buildPlanningWeeks(state, reportRange.start, reportRange.end, reportReferenceDate, reportSavingsCashOutflow, plannerOpeningBalance)
    : []
  const reportCycle = reportPlanningRange
    ? createPlannerCycle(state, reportRange.start, reportRange.end)
    : null
  const reportPlannerMetrics = reportCycle
    ? buildPlannerPeriodMetrics(
        reportCycle,
        planningWeeks,
        reportRange.incomeCents,
        reportRange.expenseCents,
        reportOpeningBalance,
        reportSavingsCashOutflow,
      )
    : null
  const reportProjectedClosingBalance = reportPlannerMetrics?.plannerCycleClosingBalanceCents
    ?? reportOpeningBalance + reportAfterSavings
  const reportCalendarRangeLabel = financialRangeLabel(reportRange.start, reportRange.end, state.settings.locale)
  const reportPlannerRangeLabel = reportCycle
    ? financialRangeLabel(reportCycle.plannerRange.start, reportCycle.plannerRange.end, state.settings.locale)
    : reportCalendarRangeLabel
  const reportCycleEndLabel = reportCycle
    ? new Intl.DateTimeFormat(state.settings.locale, { day: 'numeric', month: 'short' }).format(fromIsoDate(reportCycle.plannerRange.end))
    : new Intl.DateTimeFormat(state.settings.locale, { day: 'numeric', month: 'short' }).format(fromIsoDate(reportRange.end))
  const reportMonthName = new Intl.DateTimeFormat(state.settings.locale, { month: 'long', year: 'numeric' }).format(reportReferenceDate)

  const plannerReportStart = toIsoDate(startOfMonth(plannerMonth))
  const plannerReportEnd = toIsoDate(endOfMonth(plannerMonth))
  const plannerCycle = plannerCycleOverride ?? createPlannerCycle(state, plannerReportStart, plannerReportEnd)
  const plannerActualSavings = savingsContributedInRange(state, plannerCycle.plannerRange.start, plannerCycle.plannerRange.end)
  const plannerAnchorDate = new Date()
  const plannerAnchorReportStart = toIsoDate(startOfMonth(plannerAnchorDate))
  const plannerAnchorReportEnd = toIsoDate(endOfMonth(plannerAnchorDate))
  const plannerAnchorCycle = createPlannerCycle(state, plannerAnchorReportStart, plannerAnchorReportEnd)
  const plannerAnchorOpeningBalance = buildRollingBalanceProjection(
    state,
    plannerAnchorCycle.plannerRange.start,
    plannerAnchorCycle.plannerRange.end,
    plannerAnchorDate,
  ).openingBalanceCents
  const plannerSavingsForCycle = (cycle: PlannerCycle) => Math.max(plannedMonthlySavings, savingsContributedInRange(state, cycle.plannerRange.start, cycle.plannerRange.end))
  const plannerWeeks = plannerCycle.reportRange.start >= plannerAnchorCycle.reportRange.start
    ? buildPlannerWeeksWithCarry(
      state,
      plannerAnchorCycle,
      plannerCycle,
      plannerMonth,
      plannerAnchorOpeningBalance,
      plannerSavingsForCycle,
    )
    : buildPlanningWeeks(
      state,
      plannerCycle.reportRange.start,
      plannerCycle.reportRange.end,
      plannerMonth,
      plannerSavingsForCycle(plannerCycle),
      buildRollingBalanceProjection(state, plannerCycle.plannerRange.start, plannerCycle.plannerRange.end, plannerMonth).openingBalanceCents,
      plannerCycle.plannerRange,
    )
  const plannerCycleSummary = buildPlannerCycleSummary(plannerWeeks)
  const plannerLabel = new Intl.DateTimeFormat(state.settings.locale, { month: 'long', year: 'numeric' }).format(plannerMonth)
  const plannerCycleRangeLabel = financialRangeLabel(plannerCycle.plannerRange.start, plannerCycle.plannerRange.end, state.settings.locale)
  const visiblePrivacy = state.settings.hideSensitiveValues || state.settings.privacyMode

  const dashboardWeekRadius = compactDashboard ? 4 : 8
  const dashboardWeeks = Array.from({ length: dashboardWeekRadius * 2 + 1 }, (_, index) => {
    const offset = index - dashboardWeekRadius
    const snapshot = buildWeekSnapshot(state, addDays(new Date(), offset * 7))
    return {
      ...snapshot,
      label: offset === 0 ? 'Now' : offset > 0 ? `+${offset}w` : `${offset}w`,
      offset,
      projected: offset > 0,
    }
  })

  const historicNet = dashboardWeeks
    .filter((week) => !week.projected)
    .reduce((total, week) => total + week.remainingCents, 0)
  let projectedBalance = weekSnapshot.availableCents - historicNet
  const dashboardChart = dashboardWeeks.map((week) => {
    projectedBalance += week.remainingCents
    return {
      label: week.label,
      income: week.incomeCents / 100,
      expenses: week.expenseCents / 100,
      balance: projectedBalance / 100,
      projected: week.projected,
      start: week.start,
    }
  })

  const negativeProjection = dashboardChart.find((point) => point.projected && point.balance < 0)
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(new Date(`${weekSnapshot.start}T12:00:00`), index)
    const dateIso = toIsoDate(date)
    const items = weekSnapshot.items.filter((item) => item.date === dateIso)
    const net = items.reduce((total, item) => total + (item.kind === 'income' ? item.amountCents : -item.amountCents), 0)
    const projected = weekBalanceProjection.days.find((day) => day.date === dateIso)
    return { date, dateIso, items, net, closingBalanceCents: projected?.closingBalanceCents ?? weekBalanceProjection.openingBalanceCents }
  })

  const weekBalanceMessage = weekBalanceProjection.closingBalanceCents >= 0
    ? `This week opens with ${money(weekBalanceProjection.openingBalanceCents, state)} and is projected to close with ${money(weekBalanceProjection.closingBalanceCents, state)}.`
    : `This week opens with ${money(weekBalanceProjection.openingBalanceCents, state)} and is projected to close ${money(Math.abs(weekBalanceProjection.closingBalanceCents), state)} short.`

  const dashboardMoney = (amountCents: number, options?: { sign?: boolean; compact?: boolean }) => {
    if (visiblePrivacy) {
      return '••••'
    }

    const absolute = Math.abs(amountCents) / 100
    const formatted = new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency: 'EUR',
      notation: options?.compact ? 'compact' : 'standard',
      maximumFractionDigits: options?.compact ? 1 : 2,
    }).format(absolute)
    if (!options?.sign) return amountCents < 0 ? `−${formatted}` : formatted
    return amountCents < 0 ? `−${formatted}` : `+${formatted}`
  }

  const greetingHour = new Date().getHours()
  const greeting = greetingHour < 12 ? 'Good morning' : greetingHour < 18 ? 'Good afternoon' : 'Good evening'
  const todayLabel = new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
  const weekTrend = weekSnapshot.remainingCents
  const nextPayday = buildVisibleItems(state, todayIso(), toIsoDate(addDays(new Date(), 35)), new Date())
    .filter((item) => item.kind === 'income' && item.status !== 'completed')
    .sort((left, right) => left.date.localeCompare(right.date))[0]
  const nextPaydayDays = nextPayday ? Math.max(0, Math.ceil((new Date(`${nextPayday.date}T12:00:00`).getTime() - new Date().setHours(12, 0, 0, 0)) / 86_400_000)) : null
  const nextPaydayPerson = nextPayday
    ? state.members.find((member) => member.id === nextPayday.personId)?.name ?? nextPayday.personId ?? nextPayday.title
    : 'No payday scheduled'

  const monthStartIso = toIsoDate(startOfMonth(new Date()))
  const monthEndIso = toIsoDate(endOfMonth(new Date()))
  const monthSummary = summarizeRange(state, monthStartIso, monthEndIso, new Date())
  const savingsRate = monthSummary.incomeCents > 0 ? Math.min(100, Math.round((plannedMonthlySavings / monthSummary.incomeCents) * 100)) : 0

  const sparklineStart = addDays(new Date(), -29)
  const lastThirtyDays = Array.from({ length: 30 }, (_, index) => toIsoDate(addDays(sparklineStart, index)))
  const thirtyDayTransactions = state.transactions.filter((transaction) => transaction.status !== 'cancelled' && transaction.transactionDate >= lastThirtyDays[0] && transaction.transactionDate <= lastThirtyDays.at(-1)!)
  const thirtyDayNet = thirtyDayTransactions.reduce((total, transaction) => total + (transaction.type === 'income' ? transaction.amountCents : transaction.type === 'expense' ? -transaction.amountCents : 0), 0)
  let sparkBalance = weekSnapshot.availableCents - thirtyDayNet
  const balanceSparkline = lastThirtyDays.map((date) => {
    sparkBalance += thirtyDayTransactions.filter((transaction) => transaction.transactionDate === date).reduce((total, transaction) => total + (transaction.type === 'income' ? transaction.amountCents : transaction.type === 'expense' ? -transaction.amountCents : 0), 0)
    return { date, balance: sparkBalance / 100 }
  })

  const categoryDistribution = monthSummary.topCategories
  const dashboardCategories = categoryDistribution.length <= 6
    ? categoryDistribution
    : [
        ...categoryDistribution.slice(0, 5),
        {
          categoryId: 'other',
          categoryName: 'Other',
          amountCents: categoryDistribution.slice(5).reduce((total, category) => total + category.amountCents, 0),
        },
      ]
  const categoryTotal = dashboardCategories.reduce((total, category) => total + category.amountCents, 0)

  const recentTransactions = state.transactions
    .filter((transaction) => transaction.status !== 'cancelled')
    .filter((transaction) => activityFilter === 'all' || transaction.type === activityFilter)
    .sort((left, right) => right.transactionDate.localeCompare(left.transactionDate) || right.createdAt.localeCompare(left.createdAt))
    .slice(0, 8)

  const billWindowItems = buildVisibleItems(
    state,
    toIsoDate(addDays(new Date(), -90)),
    toIsoDate(addDays(new Date(), 365)),
    new Date(),
  )
  const billCounts = {
    all: billWindowItems.length,
    pay: billWindowItems.filter((item) => item.kind === 'bill').length,
    receive: billWindowItems.filter((item) => item.kind === 'income').length,
    overdue: billWindowItems.filter((item) => item.status === 'overdue').length,
  }
  const filteredBills = billWindowItems.filter((item) => {
    if (billFilter === 'pay') return item.kind === 'bill'
    if (billFilter === 'receive') return item.kind === 'income'
    if (billFilter === 'overdue') return item.status === 'overdue'
    return true
  })
  const selectedBills = billWindowItems.filter((item) => selectedBillIds.has(item.id))

  const savingsChart = Array.from({ length: 12 }, (_, index) => {
    const monthsAgo = 11 - index
    return {
      label: new Intl.DateTimeFormat(state.settings.locale, { month: 'short' }).format(addMonths(new Date(), -monthsAgo)),
      saved: Math.max(
        0,
        (savedTotal - state.goals.reduce((total, goal) => total + goal.monthlyContributionCents * monthsAgo, 0)) / 100,
      ),
    }
  })

  const moveReportPeriod = (direction: -1 | 1) => {
    setReportReferenceDate((current) => {
      if (reportPeriod === 'week') return addDays(current, direction * 7)
      if (reportPeriod === 'month') return addMonths(current, direction)
      if (reportPeriod === 'year') return addMonths(current, direction * 12)
      return current
    })
  }

  const moveInteractivePlannerCycle = (direction: -1 | 1) => {
    const nextCycle = movePlannerCycle(state, plannerCycle, direction)
    setPlannerCycleOverride(nextCycle)
    setPlannerMonth(fromIsoDate(nextCycle.reportRange.start))
    setPlannerSelectedItem(null)
  }

  const resetInteractivePlannerCycle = () => {
    setPlannerMonth(new Date())
    setPlannerCycleOverride(null)
    setPlannerSelectedItem(null)
  }

  const savePdfReport = () => {
    const isPlanner = planningWeeks.length > 0
    const pdf = new jsPDF({ orientation: isPlanner ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    pdf.setFontSize(18)
    pdf.text(reportTitle || 'HomeCoin', 14, 18)
    pdf.setFontSize(11)
    pdf.text(`Period: ${reportRange.label}`, 14, 28)
    pdf.text(`Income: ${money(reportRange.incomeCents, state)}`, 14, 36)
    pdf.text(`Expenses: ${money(reportRange.expenseCents, state)}`, 14, 44)
    pdf.text(`Income minus bills: ${money(reportRange.remainingCents, state)}`, 72, 36)
    pdf.text(`Savings still planned: ${money(reportSavingsStillPlanned, state)}`, 72, 44)
    pdf.text(`${reportPeriod === 'month' ? 'Planner cycle closing balance' : 'Period closing balance'}: ${money(reportProjectedClosingBalance, state)}`, 145, 36)
    pdf.text(`Saved this period: ${money(reportActualSavings, state)}`, 145, 44)
    if (reportPeriod === 'month' && isPlanner) {
      pdf.setFontSize(8)
      pdf.setTextColor(107, 115, 115)
      pdf.text('Adjacent days are shown to complete each week and calculate the balance correctly.', 14, 51)
      pdf.setTextColor(45, 58, 58)
    }

    if (isPlanner) {
      const drawWeek = (week: (typeof planningWeeks)[number], pageIndex: number) => {
        if (pageIndex > 0) {
          pdf.addPage('a4', 'landscape')
          pdf.setFontSize(16)
          pdf.text(reportTitle || 'HomeCoin household plan', 14, 16)
        }
        pdf.setFontSize(12)
        pdf.text(`Week ${week.label.replace(/–/g, '-')}`, 14, pageIndex > 0 ? 26 : 55)
        const top = pageIndex > 0 ? 32 : 61
        const columnWidth = (pageWidth - 28) / 7
        const columnHeight = 112
        week.days.forEach((day, dayIndex) => {
          const x = 14 + dayIndex * columnWidth
          pdf.setFillColor(day.inPeriod ? 250 : 242, day.inPeriod ? 247 : 242, day.inPeriod ? 242 : 242)
          pdf.setDrawColor(220, 226, 219)
          pdf.rect(x, top, columnWidth, columnHeight, 'FD')
          pdf.setFontSize(9)
          pdf.setTextColor(45, 58, 58)
          pdf.text(day.label, x + 2, top + 6, { maxWidth: columnWidth - 4 })
          let cursor = top + 13
          pdf.setFontSize(7.5)
          day.items.slice(0, 7).forEach((item) => {
            const line = `${item.kind === 'income' ? '+' : '-'}${money(item.amountCents, state)} ${item.title}`
            const lines = pdf.splitTextToSize(line, columnWidth - 4).slice(0, 2)
            pdf.text(lines, x + 2, cursor)
            cursor += lines.length * 4 + 1
          })
          if (!day.items.length && day.inPeriod) {
            pdf.setTextColor(107, 115, 115)
            pdf.text('Nothing planned', x + 2, cursor)
          }
          pdf.setTextColor(45, 58, 58)
          pdf.setFontSize(7)
          pdf.text(`In ${money(day.incomeCents, state)}`, x + 2, top + columnHeight - 18)
          pdf.text(`Bills ${money(day.expenseCents, state)}`, x + 2, top + columnHeight - 13)
          pdf.text(`Income - bills ${money(day.remainingCents, state)}`, x + 2, top + columnHeight - 8)
          pdf.text(`Running ${money(day.closingBalanceCents, state)}`, x + 2, top + columnHeight - 3)
        })
        const totalsY = top + columnHeight + 9
        pdf.setFontSize(9)
        pdf.text(`Opening ${money(week.openingBalanceCents, state)}`, 14, totalsY)
        pdf.text(`Income ${money(week.incomeCents, state)}`, 62, totalsY)
        pdf.text(`Bills ${money(week.expenseCents, state)}`, 105, totalsY)
        pdf.text(`Income - bills ${money(week.remainingCents, state)}`, 145, totalsY)
        pdf.text(`Savings ${money(week.plannedSavingsCents, state)}`, 184, totalsY)
        pdf.text(`Closing ${money(week.closingBalanceCents, state)}`, 232, totalsY)
        pdf.setFontSize(8)
        pdf.setTextColor(107, 115, 115)
        pdf.text(`Savings accumulated ${money(savedTotal, state)} - actually saved in period ${money(reportActualSavings, state)}`, 14, totalsY + 9)
      }
      planningWeeks.forEach(drawWeek)
      if (reportPeriod === 'month') {
        pdf.addPage('a4', 'landscape')
        pdf.setTextColor(45, 58, 58)
        pdf.setFontSize(18)
        pdf.text('Monthly grand summary', 14, 18)
        pdf.setFontSize(9)
        pdf.setTextColor(107, 115, 115)
        pdf.text(`Calendar month: ${reportCalendarRangeLabel} | Planner cycle: ${reportPlannerRangeLabel}`, 14, 25)

        const summaryMetrics = [
          ['Calendar month income', reportRange.incomeCents],
          ['Calendar month expenses', reportRange.expenseCents],
          ['Calendar month result', reportRange.remainingCents],
          ['Opening balance', reportOpeningBalance],
          ['Saved this month', reportActualSavings],
          ['Planner cycle closing balance', reportProjectedClosingBalance],
        ] as const
        const metricWidth = (pageWidth - 34) / 3
        summaryMetrics.forEach(([label, value], index) => {
          const column = index % 3
          const row = Math.floor(index / 3)
          const x = 14 + column * (metricWidth + 3)
          const y = 33 + row * 24
          pdf.setFillColor(250, 247, 242)
          pdf.setDrawColor(220, 226, 219)
          pdf.roundedRect(x, y, metricWidth, 20, 2, 2, 'FD')
          pdf.setTextColor(107, 115, 115)
          pdf.setFontSize(7.5)
          pdf.text(label, x + 3, y + 6)
          pdf.setTextColor(value < 0 ? 183 : 47, value < 0 ? 86 : 125, value < 0 ? 62 : 91)
          pdf.setFontSize(12)
          pdf.text(money(value, state), x + 3, y + 15)
        })

        const chartTop = 88
        const comparisonWidth = 118
        const comparisonMax = Math.max(1, reportRange.incomeCents, reportRange.expenseCents)
        pdf.setTextColor(45, 58, 58)
        pdf.setFontSize(12)
        pdf.text('Income and expenses', 14, chartTop)
        const comparisonRows = [
          ['Income', reportRange.incomeCents, [47, 125, 91]],
          ['Expenses', reportRange.expenseCents, [217, 119, 87]],
        ] as const
        comparisonRows.forEach(([label, value, color], index) => {
          const y = chartTop + 10 + index * 18
          pdf.setFontSize(8)
          pdf.setTextColor(45, 58, 58)
          pdf.text(label, 14, y)
          pdf.text(money(value, state), 14 + comparisonWidth, y, { align: 'right' })
          pdf.setFillColor(239, 235, 228)
          pdf.roundedRect(14, y + 3, comparisonWidth, 6, 2, 2, 'F')
          pdf.setFillColor(color[0], color[1], color[2])
          pdf.roundedRect(14, y + 3, comparisonWidth * value / comparisonMax, 6, 2, 2, 'F')
        })

        const categoryX = 154
        pdf.setTextColor(45, 58, 58)
        pdf.setFontSize(12)
        pdf.text('Expenses by category', categoryX, chartTop)
        reportDistribution.slice(0, 8).forEach((entry, index) => {
          const y = chartTop + 9 + index * 11
          const percent = reportRange.expenseCents > 0 ? Math.round(entry.amountCents / reportRange.expenseCents * 100) : 0
          pdf.setFontSize(7.5)
          pdf.setTextColor(45, 58, 58)
          pdf.text(entry.categoryName, categoryX, y)
          pdf.text(`${money(entry.amountCents, state)} (${percent}%)`, pageWidth - 14, y, { align: 'right' })
          pdf.setFillColor(239, 235, 228)
          pdf.rect(categoryX, y + 2, pageWidth - categoryX - 14, 2, 'F')
          pdf.setFillColor(74, 111, 165)
          pdf.rect(categoryX, y + 2, (pageWidth - categoryX - 14) * percent / 100, 2, 'F')
        })

        pdf.setFillColor(243, 247, 243)
        pdf.roundedRect(14, 176, pageWidth - 28, 18, 2, 2, 'F')
        pdf.setTextColor(45, 58, 58)
        pdf.setFontSize(10)
        const conclusion = `${reportMonthName} result: ${money(reportRange.remainingCents, state)}. ` +
          (reportProjectedClosingBalance >= 0
            ? `After the financial week through ${reportCycleEndLabel}, ${money(reportProjectedClosingBalance, state)} remains.`
            : `After the financial week through ${reportCycleEndLabel}, the planner is ${money(Math.abs(reportProjectedClosingBalance), state)} short.`)
        pdf.text(conclusion, 18, 187)
      }
      pdf.save(`homecoin-${reportPeriod}-planner.pdf`)
      return
    }

    let cursor = 66
    pdf.setFontSize(13)
    pdf.text('Top categories', 14, cursor)
    cursor += 8
    pdf.setFontSize(10)
    reportDistribution.slice(0, 6).forEach((entry) => {
      pdf.text(`${entry.categoryName}: ${money(entry.amountCents, state)}`, 14, cursor)
      cursor += 6
    })

    pdf.save(`homecoin-${reportPeriod}.pdf`)
  }

  const exportReportCsv = () => {
    const csv = Papa.unparse(
      reportItems.map((item) => ({
        date: item.date,
        title: item.title,
        type: item.kind,
        status: item.status,
        amount: (item.amountCents / 100).toFixed(2),
        source: item.sourceKind,
      })),
    )

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `homecoin-${reportPeriod}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const dashboardView = (
    <section className="dashboard-page">
      <div className="dashboard-greeting">
        <div><p className="eyebrow">Household overview</p><h1>{greeting}, {state.household.name}</h1></div>
        <time dateTime={todayIso()}>{todayLabel}</time>
      </div>

      {negativeProjection ? (
        <div className="warning-banner dashboard-warning" role="alert">
          <span aria-hidden="true">⚠</span>
          <span><strong>Heads up</strong> — the week of {formatSimpleDay(negativeProjection.start, 'en-IE')} projects a {dashboardMoney(Math.abs(Math.round(negativeProjection.balance * 100)))} shortfall. Review upcoming expenses.</span>
        </div>
      ) : null}

      <div className="dashboard-band dashboard-band-hero">
        <Card className="dashboard-card hero-balance-card">
          <p className="hero-balance-label">Current balance</p>
          <button className={`hero-balance-value ${weekSnapshot.availableCents >= 0 ? 'money-positive' : 'money-negative'}`} onClick={() => setActiveSection('bills')}>
            {dashboardMoney(weekSnapshot.availableCents)}
          </button>
          <p className={`hero-balance-trend ${weekTrend >= 0 ? 'money-positive' : 'money-negative'}`}>
            {weekTrend >= 0 ? '▲' : '▼'} {dashboardMoney(weekTrend, { sign: true })} this week
          </p>
          <div className="balance-sparkline" aria-label="Balance over the last 30 days">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={balanceSparkline} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
                <defs><linearGradient id="balanceSparkFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} /><stop offset="100%" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs>
                <Area type="monotone" dataKey="balance" stroke="var(--accent)" strokeWidth={2.25} fill="url(#balanceSparkFill)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="hero-balance-actions">
            <button onClick={() => openQuickTransaction('income', 'Income')}><Plus size={15} /> Income</button>
            <button onClick={() => openQuickTransaction('bill', 'Expense')}><Plus size={15} /> Expense</button>
          </div>
        </Card>

        <div className="dashboard-stat-grid">
          <button className="dashboard-card stat-mini-card" onClick={() => setActiveSection('week')}>
            <span>This week after bills</span><strong className={weekTrend >= 0 ? 'money-positive' : 'money-negative'}>{dashboardMoney(weekTrend, { sign: true })}</strong><small>income minus bills</small>
          </button>
          <button className="dashboard-card stat-mini-card" onClick={() => setActiveSection('recurring')}>
            <span>Next payday</span>
            <strong>{nextPaydayDays === null ? '—' : nextPaydayDays === 0 ? 'today' : `in ${nextPaydayDays} day${nextPaydayDays === 1 ? '' : 's'}`}</strong>
            <small>{nextPayday ? `${nextPaydayPerson} ${dashboardMoney(nextPayday.amountCents)}` : nextPaydayPerson}</small>
          </button>
          <button className="dashboard-card stat-mini-card stat-savings-rate" onClick={() => setActiveSection('savings')}>
            <span>Savings rate</span>
            <div><strong>{savingsRate}%</strong><span className="savings-rate-ring" style={{ '--rate': `${savingsRate * 3.6}deg` } as React.CSSProperties} /></div>
            <small>of income this month</small>
          </button>
        </div>
      </div>

      <div className="dashboard-band dashboard-band-middle">
        <Card className="dashboard-card cashflow-card">
          <div className="dashboard-card-heading"><div><h2>Cash flow</h2><p>{compactDashboard ? '4 weeks back, 4 weeks ahead' : '8 weeks back, 8 weeks ahead'}</p></div><div className="chart-key"><span className="income" />Income<span className="expense" />Expenses<span className="balance" />Balance</div></div>
          {state.transactions.length < 3 ? (
            <div className="cashflow-empty"><EmptyState title="Add a few weeks of activity" copy="Add a few weeks of activity to see your cash flow projection." action="+ Add first income" onAction={() => openQuickTransaction('income', 'Income')} /></div>
          ) : (
            <div className="cashflow-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dashboardChart} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 5" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                  <YAxis width={52} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={(value) => `€${new Intl.NumberFormat('en-IE', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value))}`} />
                  <Tooltip cursor={{ fill: 'rgba(47, 125, 91, 0.04)' }} contentStyle={{ background: 'var(--bg-soft)', border: '1px solid var(--accent)', borderRadius: 12, color: 'var(--text)', boxShadow: 'var(--shadow-soft)', fontVariantNumeric: 'tabular-nums' }} labelStyle={{ color: 'var(--text)', fontWeight: 750 }} formatter={(value, name) => [dashboardMoney(Math.round(Number(value) * 100)), String(name)]} />
                  <ReferenceLine x="Now" stroke="var(--blue)" strokeDasharray="4 4" label={{ value: 'Today', position: 'top', fill: 'var(--blue)', fontSize: 11 }} />
                  <Bar dataKey="income" name="Income" fill="var(--accent)" radius={[5, 5, 0, 0]} maxBarSize={22}>{dashboardChart.map((point) => <Cell key={`income-${point.label}`} fillOpacity={point.projected ? 0.45 : 0.9} />)}</Bar>
                  <Bar dataKey="expenses" name="Expenses" fill="var(--warning)" radius={[5, 5, 0, 0]} maxBarSize={22}>{dashboardChart.map((point) => <Cell key={`expense-${point.label}`} fillOpacity={point.projected ? 0.42 : 0.86} />)}</Bar>
                  <Line type="monotone" dataKey="balance" name="Balance" stroke="var(--accent-strong)" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: 'var(--accent)', stroke: 'var(--surface-strong)', strokeWidth: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="dashboard-card week-agenda-card">
          <div className="dashboard-card-heading"><div><h2>This week</h2><p>{weekSnapshot.label}</p></div><CalendarRange size={20} /></div>
          <div className="week-agenda-list">
            {weekDays.map((day) => (
              <div className="agenda-day" key={day.dateIso}>
                <div className="agenda-day-label"><strong>{new Intl.DateTimeFormat('en-IE', { weekday: 'short' }).format(day.date)}</strong><span>{day.date.getDate()}</span></div>
                <div className="agenda-day-items">
                  {day.items.length ? day.items.map((item) => (
                    <button key={item.id} className={`agenda-chip ${item.kind}`} data-overdue={item.status === 'overdue'} onClick={() => openEditTransaction(item)}>
                      <span>{item.title}</span><strong>{dashboardMoney(item.kind === 'income' ? item.amountCents : -item.amountCents, { sign: true })}</strong>
                    </button>
                  )) : <span className="agenda-empty">— nothing planned</span>}
                </div>
              </div>
            ))}
          </div>
          <button className="week-agenda-net" onClick={() => setActiveSection('week')}><span>Income minus bills</span><strong className={weekTrend >= 0 ? 'money-positive' : 'money-negative'}>{dashboardMoney(weekTrend, { sign: true })}</strong></button>
        </Card>
      </div>

      <div className="dashboard-band dashboard-band-bottom">
        <Card className="dashboard-card savings-summary-card">
          <div className="dashboard-card-heading"><div><h2>Savings goals</h2><p>Progress at a glance</p></div><Target size={20} /></div>
          <div className="compact-goals">
            {state.goals.filter((goal) => !goal.archived).length ? state.goals.filter((goal) => !goal.archived).map((goal, index) => {
              const percent = goal.targetCents ? Math.min(100, Math.round((goal.currentCents / goal.targetCents) * 100)) : 0
              return <button key={goal.id} className="compact-goal-row" onClick={() => setActiveSection('savings')}><span className="compact-goal-name"><b>{['🎯', '✈️', '🏡', '🌱'][index % 4]}</b>{goal.name}</span><span className="compact-goal-progress"><i style={{ width: `${percent}%` }} /></span><span className="compact-goal-values"><strong>{dashboardMoney(goal.currentCents)} / {dashboardMoney(goal.targetCents)}</strong><small>{percent}%</small></span></button>
            }) : <EmptyState title="No savings goals yet" copy="Give your next milestone a name." action="Create a goal" onAction={() => setActiveSection('savings')} />}
          </div>
          <button className="dashboard-card-link" onClick={() => setActiveSection('savings')}>View all →</button>
        </Card>

        <Card className="dashboard-card category-donut-card">
          <div className="dashboard-card-heading"><div><h2>This month by category</h2><p>Expense mix</p></div></div>
          {dashboardCategories.length ? <>
            <div className="category-donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={dashboardCategories} dataKey="amountCents" nameKey="categoryName" innerRadius="64%" outerRadius="88%" paddingAngle={2} stroke="none" isAnimationActive={false}>{dashboardCategories.map((entry, index) => <Cell key={entry.categoryId} fill={RESULT_COLORS[index % RESULT_COLORS.length]} />)}</Pie><Tooltip contentStyle={{ background: 'var(--bg-soft)', border: '1px solid var(--accent)', borderRadius: 12, color: 'var(--text)' }} formatter={(value) => dashboardMoney(Number(value))} /></PieChart></ResponsiveContainer><div className="category-donut-center"><span>Spent</span><strong>{dashboardMoney(categoryTotal, { compact: true })}</strong></div></div>
            <div className="category-legend">{dashboardCategories.map((category, index) => <div key={category.categoryId}><span style={{ background: RESULT_COLORS[index % RESULT_COLORS.length] }} /><b>{category.categoryName}</b><strong>{dashboardMoney(category.amountCents, { compact: true })}</strong></div>)}</div>
          </> : <EmptyState title="No expenses yet" copy="Expense categories will appear here." />}
        </Card>

        <Card className="dashboard-card recent-activity-card">
          <div className="dashboard-card-heading"><div><h2>Recent activity</h2><p>Latest household movements</p></div><select aria-label="Filter recent activity" value={activityFilter} onChange={(event) => setActivityFilter(event.target.value as ActivityFilter)}><option value="all">All</option><option value="income">Income</option><option value="expense">Expenses</option></select></div>
          <div className="recent-activity-list">
            {recentTransactions.length ? recentTransactions.map((transaction) => {
              const category = state.categories.find((entry) => entry.id === transaction.categoryId)
              const isIncome = transaction.type === 'income'
              return <button key={transaction.id} className="recent-activity-row" onClick={() => setActiveSection('bills')}><time>{new Intl.DateTimeFormat('en-IE', { day: '2-digit', month: 'short' }).format(new Date(`${transaction.transactionDate}T12:00:00`))}</time><span className="recent-activity-name"><strong>{transaction.title}</strong><small style={{ '--category-color': category?.color ?? 'var(--blue)' } as React.CSSProperties}>{category?.name ?? 'Uncategorised'}</small></span><b className={isIncome ? 'money-positive' : 'money-negative'}>{dashboardMoney(isIncome ? transaction.amountCents : -transaction.amountCents, { sign: true })}</b></button>
            }) : <EmptyState title="No recent activity" copy="New household transactions will appear here." />}
          </div>
          <button className="dashboard-card-link" onClick={() => setActiveSection('bills')}>See all →</button>
        </Card>
      </div>
    </section>
  )

  const weekView = (
    <section className="grid gap-5">
      <Card className="p-5 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-700">This week</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{weekSnapshot.label}</h1>
            <p className="mt-2 max-w-2xl text-slate-600">{weekBalanceMessage} The closing balance carries into the next week.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setWeekReferenceDate((date) => addDays(date, -7))}
            >
              ‹ Previous
            </Button>
            <Button variant="secondary" onClick={() => setWeekReferenceDate(new Date())}>
              Today
            </Button>
            <Button variant="secondary" onClick={() => setWeekReferenceDate((date) => addDays(date, 7))}>
              Next ›
            </Button>
            <Button variant="primary" onClick={() => openAddTransaction('bill')}>
              + Add
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              Print week
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Opening balance" value={money(weekBalanceProjection.openingBalanceCents, state)} />
        <MetricCard label="Income this week" value={money(weekSnapshot.incomeCents, state)} />
        <MetricCard label="Bills this week" value={money(weekSnapshot.expenseCents, state)} />
        <MetricCard label="Projected closing balance" value={money(weekBalanceProjection.closingBalanceCents, state)} highlight />
      </div>

      <Card className="p-5">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Summary</p>
        <p className="mt-3 text-xl font-semibold text-slate-900">{weekBalanceMessage}</p>
        <p className="mt-2 text-sm text-slate-500">Income minus bills this week: {money(weekSnapshot.remainingCents, state)}. Available spendable balance now: {money(currentSpendableBalance(state), state)}. The projected closing balance becomes next week's opening balance.</p>
      </Card>

      <div className="week-calendar">
        {weekDays.map((day) => (
          <Card key={day.dateIso} className="week-day-card" data-today={day.dateIso === todayIso()}>
            <div className="week-day-heading"><span>{new Intl.DateTimeFormat(state.settings.locale, { weekday: 'short' }).format(day.date)}</span><strong>{day.date.getDate()}</strong></div>
            <div className="week-items">
              {day.items.slice(0, 5).map((item) => (
                <button key={item.id} className={`week-chip ${item.kind}`} data-overdue={item.status === 'overdue'} onClick={() => openEditTransaction(item)}>
                  <span>{item.title}</span><strong>{money(item.amountCents, state)}</strong>
                </button>
              ))}
              {day.items.length > 5 ? <small>+{day.items.length - 5} more</small> : null}
              {!day.items.length ? <span className="week-empty">Nothing planned</span> : null}
            </div>
            <div className="week-day-totals">
              <span className={day.net >= 0 ? 'money-positive' : 'money-negative'}>Income - bills <b>{money(day.net, state)}</b></span>
              <span className={day.closingBalanceCents >= 0 ? 'money-positive' : 'money-negative'}>Running balance <b>{money(day.closingBalanceCents, state)}</b></span>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Income</h2>
              <p className="text-sm text-slate-500">Expected and received income</p>
            </div>
            <Button variant="ghost" onClick={() => openAddTransaction('income')}>
              Add
            </Button>
          </div>
          <div className="grid gap-3">
            {weekSnapshot.incomeItems.length > 0 ? (
              weekSnapshot.incomeItems.map((item) => (
                <ItemRow key={item.id} item={item} state={state} onToggle={completeItem} onEdit={openEditTransaction} />
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-[color:var(--border)] bg-slate-50 px-4 py-8 text-center text-slate-500">
                No income this week.
              </div>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Bills</h2>
              <p className="text-sm text-slate-500">Payments and obligations this week</p>
            </div>
            <Button variant="ghost" onClick={() => openAddTransaction('bill')}>
              Add
            </Button>
          </div>
          <div className="grid gap-3">
            {weekSnapshot.billItems.length > 0 ? (
              weekSnapshot.billItems.map((item) => (
                <ItemRow key={item.id} item={item} state={state} onToggle={completeItem} onEdit={openEditTransaction} />
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-[color:var(--border)] bg-slate-50 px-4 py-8 text-center text-slate-500">
                No bills this week.
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Next four weeks</h2>
            <p className="text-sm text-slate-500">A compact look at your short-term cash flow</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {nextWeeksWithBalance.map((preview) => (
            <div key={preview.start} className="rounded-3xl border border-[color:var(--border)] bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">{preview.label}</p>
              <div className="mt-3 grid gap-2 text-sm text-slate-600">
                <div>Income: {money(preview.incomeCents, state)}</div>
                <div>Bills: {money(preview.expenseCents, state)}</div>
                <div>Income minus bills: {money(preview.remainingCents, state)}</div>
                <div>Opening: {money(preview.balance.openingBalanceCents, state)}</div>
                <div className="font-semibold text-slate-900">Projected closing: {money(preview.balance.closingBalanceCents, state)}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </section>
  )

  const monthCalendar = (
    <section className="grid gap-5">
      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-700">Monthly calendar</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{calendarSnapshot.monthLabel}</h1>
            <p className="mt-2 text-slate-600">Each day keeps income, bills, and pending items easy to scan.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setCalendarMonth((date) => addMonths(date, -1))}>
              ‹ Previous month
            </Button>
            <Button variant="secondary" onClick={() => setCalendarMonth(new Date())}>
              Today
            </Button>
            <Button variant="secondary" onClick={() => setCalendarMonth((date) => addMonths(date, 1))}>
              Next month ›
            </Button>
            <Button variant="secondary" onClick={() => setCalendarMode((mode) => (mode === 'month' ? 'list' : 'month'))}>
              {calendarMode === 'month' ? 'List view' : 'Month view'}
            </Button>
          </div>
        </div>
      </Card>

      {calendarMode === 'month' ? (
        <Card className="p-5">
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
              <div key={label}>{label}</div>
            ))}
          </div>
          <div className="mt-3 calendar-grid">
            {calendarSnapshot.days.map((day) => (
              <button
                key={day.date}
                className={`calendar-day card-soft text-left ${day.inMonth ? 'opacity-100' : 'opacity-45'}`}
                data-selected={selectedDay === day.date}
                onClick={() => setSelectedDay(day.date)}
              >
                <div className="flex items-center justify-between">
                  <div className="text-lg font-bold text-slate-900">{day.date.slice(8, 10)}</div>
                  {day.pendingCount > 0 ? <span className="text-[11px] font-bold text-amber-700">•</span> : null}
                </div>
                <div className="month-dots" aria-label={`${day.items.length} items`}>
                  {day.items.slice(0, 3).map((item) => <span key={item.id} className={`month-dot ${item.kind}`} data-overdue={item.status === 'overdue'} title={item.title} />)}
                </div>
                {day.items.length > 3 ? <div className="month-more">+{day.items.length - 3} more</div> : null}
                <div className="month-day-net">{day.incomeCents || day.expenseCents ? money(day.incomeCents - day.expenseCents, state) : 'No activity'}</div>
              </button>
            ))}
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <div className="grid gap-3">
            {calendarSnapshot.list.length > 0 ? (
              calendarSnapshot.list.map((day) => (
                <button
                  key={day.date}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-[color:var(--border)] bg-slate-50 px-4 py-3 text-left"
                  onClick={() => setSelectedDay(day.date)}
                >
                  <div>
                    <div className="font-semibold text-slate-900">{formatSimpleDay(day.date, state.settings.locale)}</div>
                    <div className="text-sm text-slate-500">{day.items.length} item(s)</div>
                  </div>
                  <div className="text-sm text-slate-600">
                    <div>Income {money(day.incomeCents, state)}</div>
                    <div>Bills {money(day.expenseCents, state)}</div>
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-[color:var(--border)] bg-slate-50 px-4 py-8 text-center text-slate-500">
                No items this month.
              </div>
            )}
          </div>
        </Card>
      )}
    </section>
  )

  const allRecurringRules = [...state.recurringRules].sort((left, right) => left.nextDueDate.localeCompare(right.nextDueDate))
  const isIncomeRule = (rule: RecurringRule) => ['Income', 'Receitas'].includes(state.categories.find((category) => category.id === rule.categoryId)?.group ?? '')
  const recurringRules = allRecurringRules.filter((rule) => recurringTab === 'income' ? isIncomeRule(rule) : !isIncomeRule(rule))
  const activeRules = allRecurringRules.filter((rule) => rule.active)
  const pausedRules = allRecurringRules.filter((rule) => !rule.active)
  const selectedRecurringRules = allRecurringRules.filter((rule) => selectedRuleIds.has(rule.id))

  const accountsView = (
    <section className="grid gap-5">
      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-700">Recurring plan</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Recurring income & expenses</h1>
            <p className="mt-2 text-slate-600">Keep salaries, rent, utilities, groceries, and other repeating items in one calm place.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => openRuleModal()}>
              + Add recurring item
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Active" value={String(activeRules.length)} />
        <MetricCard label="Paused" value={String(pausedRules.length)} />
        <MetricCard label="Upcoming" value={String(allRecurringRules.filter((rule) => rule.active && rule.nextDueDate >= todayIso()).length)} highlight />
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Recurring list</h2>
            <p className="text-sm text-slate-500">Add, edit, pause, duplicate, or delete a series</p>
          </div>
          <div className="filter-tabs" role="tablist" aria-label="Recurring type">
            <button role="tab" aria-selected={recurringTab === 'income'} data-active={recurringTab === 'income'} onClick={() => { setRecurringTab('income'); setSelectedRuleIds(new Set()) }}>Incomes</button>
            <button role="tab" aria-selected={recurringTab === 'expense'} data-active={recurringTab === 'expense'} onClick={() => { setRecurringTab('expense'); setSelectedRuleIds(new Set()) }}>Expenses</button>
          </div>
        </div>
        {recurringRules.length ? <label className="select-all-row"><input type="checkbox" aria-label={`Select all recurring ${recurringTab === 'income' ? 'incomes' : 'expenses'}`} checked={recurringRules.every((rule) => selectedRuleIds.has(rule.id))} onChange={(event) => setSelectedRuleIds(event.target.checked ? new Set(recurringRules.map((rule) => rule.id)) : new Set())} /> Select all {recurringTab === 'income' ? 'incomes' : 'expenses'}</label> : null}
        <div className="mt-4 grid gap-3">
          {recurringRules.length > 0 ? (
            recurringRules.map((rule) => {
              const category = state.categories.find((entry) => entry.id === rule.categoryId)
              return (
                <div
                  key={rule.id}
                  className="recurring-row flex flex-col gap-4 rounded-3xl border border-[color:var(--border)] bg-white px-4 py-4 shadow-[0_8px_18px_rgba(45,58,58,0.05)] lg:flex-row lg:items-center lg:justify-between"
                  tabIndex={0}
                  data-selected={selectedRuleIds.has(rule.id)}
                  onKeyDown={(event) => { if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteRule(rule) } }}
                >
                  <input className="row-checkbox" type="checkbox" aria-label={`Select ${rule.name}`} checked={selectedRuleIds.has(rule.id)} onChange={() => toggleSelection(setSelectedRuleIds, rule.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-lg font-semibold text-slate-900">{rule.name}</p>
                      <span className={`status-pill`} data-status={rule.active ? 'completed' : 'planned'}>
                        {rule.active ? 'Active' : 'Paused'}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-500">
                      <span>{money(rule.amountCents, state)}</span>
                      <span>•</span>
                      <span>{FREQUENCY_LABELS[rule.frequency === 'weekly' ? 'weekly' : rule.frequency === 'fortnightly' ? 'fortnightly' : rule.frequency === 'yearly' ? 'yearly' : 'monthly']}</span>
                      <span>•</span>
                      <span>Next date {formatSimpleDay(rule.nextDueDate, state.settings.locale)}</span>
                      {category ? (
                        <>
                          <span>•</span>
                          <span>{category.name}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => openRuleModal(rule)}>
                      Edit
                    </Button>
                    <Button variant="secondary" onClick={() => toggleRuleActive(rule)}>
                      {rule.active ? 'Pause' : 'Resume'}
                    </Button>
                    <Button variant="secondary" onClick={() => duplicateRule(rule)}>
                      Duplicate
                    </Button>
                    <button className="delete-icon-button" title="Delete recurring item" aria-label={`Delete ${rule.name}`} onClick={() => deleteRule(rule)}><Trash2 size={17} /></button>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-[color:var(--border)] bg-slate-50 px-4 py-8 text-center text-slate-500">
              No recurring items yet.
            </div>
          )}
        </div>
        {selectedRecurringRules.length ? <div className="bulk-action-bar"><strong>{selectedRecurringRules.length} selected</strong><Button variant="secondary" onClick={() => setSelectedRuleIds(new Set())}>Clear</Button><button className="bulk-delete-button" onClick={() => setDeleteDialog({ kind: 'recurring', rules: selectedRecurringRules })}><Trash2 size={16} /> Delete selected</button></div> : null}
      </Card>
    </section>
  )

  const billsView = (
    <section className="grid gap-5">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Money in and out</p>
          <h1>Bills</h1>
          <p>Stay ahead of every payment and receivable, sorted by due date.</p>
        </div>
        <Button variant="primary" onClick={() => openAddTransaction('bill')}><Plus size={18} /> Add bill</Button>
      </div>

      <Card className="p-3">
        <div className="filter-tabs" role="tablist" aria-label="Bill filters">
          {([
            ['all', 'All'],
            ['pay', 'To Pay'],
            ['receive', 'To Receive'],
            ['overdue', 'Overdue'],
          ] as Array<[BillFilter, string]>).map(([value, label]) => (
            <button key={value} role="tab" aria-selected={billFilter === value} data-active={billFilter === value} onClick={() => { setBillFilter(value); setSelectedBillIds(new Set()) }}>
              {label}<span>{billCounts[value]}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filteredBills.length ? (
          <div className="table-wrap">
            <table className="data-table mobile-card-table">
              <thead><tr><th className="checkbox-cell"><input type="checkbox" aria-label="Select all bills" checked={filteredBills.every((item) => selectedBillIds.has(item.id))} onChange={(event) => setSelectedBillIds(event.target.checked ? new Set(filteredBills.map((item) => item.id)) : new Set())} /></th><th>Name</th><th>Category</th><th>Direction</th><th>Due date</th><th>Status</th><th className="money-cell">Amount</th><th /></tr></thead>
              <tbody>
                {filteredBills.map((item) => {
                  const category = state.categories.find((entry) => entry.id === item.categoryId)
                  return (
                    <tr key={item.id} data-overdue={item.status === 'overdue'} data-selected={selectedBillIds.has(item.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); setDeleteDialog({ kind: 'bills', items: [item] }) } }}>
                      <td className="checkbox-cell"><input type="checkbox" aria-label={`Select ${item.title}`} checked={selectedBillIds.has(item.id)} onChange={() => toggleSelection(setSelectedBillIds, item.id)} /></td>
                      <td data-label="Name"><strong>{item.title}</strong><small>{item.notes || (item.sourceKind === 'recurring' ? 'Recurring item' : 'One-off item')}</small></td>
                      <td data-label="Category"><span className="category-pill" style={{ '--category-color': category?.color ?? '#4A6FA5' } as React.CSSProperties}>{category?.name ?? 'Uncategorised'}</span></td>
                      <td data-label="Direction">{item.kind === 'income' ? 'Receive' : 'Pay'}</td>
                      <td data-label="Due date">{formatSimpleDay(item.date, state.settings.locale)}</td>
                      <td data-label="Status"><StatusBadge status={item.status} /></td>
                      <td data-label="Amount" className={`money-cell ${item.kind === 'income' ? 'money-positive' : 'money-negative'}`}>{money(item.amountCents, state)}</td>
                      <td data-label="Actions"><div className="row-actions"><Button variant="ghost" onClick={() => openEditTransaction(item)}>Edit</Button><button className="delete-icon-button" title="Delete bill" aria-label={`Delete ${item.title}`} onClick={() => setDeleteDialog({ kind: 'bills', items: [item] })}><Trash2 size={17} /></button>{item.status !== 'completed' ? <Button variant="primary" onClick={() => completeItem(item)}>Mark {item.kind === 'income' ? 'received' : 'paid'}</Button> : null}</div></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {selectedBills.length ? <div className="bulk-action-bar"><strong>{selectedBills.length} selected</strong><Button variant="secondary" onClick={async () => { for (const item of selectedBills) await completeItem(item); setSelectedBillIds(new Set()); showToast(selectedBills.length === 1 ? 'Bill marked as paid' : `${selectedBills.length} bills marked as paid`) }}>Mark as paid</Button><button className="bulk-delete-button" onClick={() => setDeleteDialog({ kind: 'bills', items: selectedBills })}><Trash2 size={16} /> Delete selected</button></div> : null}
          </div>
        ) : <EmptyState title="No bills here" copy="This filter has no items yet." action="Add a bill" onAction={() => openAddTransaction('bill')} />}
      </Card>
    </section>
  )

  const savingsView = (
    <section className="grid gap-5">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Build your future</p>
          <h1>Savings goals</h1>
          <p>Turn small, regular contributions into visible household progress.</p>
        </div>
        <Button variant="primary" onClick={() => openGoalModal()}><Plus size={18} /> New goal</Button>
      </div>

      {state.goals.filter((goal) => !goal.archived).length ? (
        <div className="goal-grid">
          {state.goals.filter((goal) => !goal.archived).map((goal) => {
            const percent = goal.targetCents > 0 ? Math.min(100, Math.round((goal.currentCents / goal.targetCents) * 100)) : 0
            const remaining = Math.max(0, goal.targetCents - goal.currentCents)
            const months = goal.monthlyContributionCents > 0 ? Math.ceil(remaining / goal.monthlyContributionCents) : 0
            const reachDate = months ? addMonths(new Date(), months) : null
            return (
              <Card key={goal.id} className="goal-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="goal-icon"><Target size={22} /></div>
                  <div className="row-actions"><Button variant="ghost" onClick={() => openGoalModal(goal)}>Edit</Button><Button variant="ghost" onClick={() => deleteGoal(goal)}>Delete</Button></div>
                </div>
                <h2>{goal.name}</h2>
                <div className="goal-values"><strong>{money(goal.currentCents, state)}</strong><span>of {money(goal.targetCents, state)}</span></div>
                <div className="progress-track" aria-label={`${percent}% complete`}><span style={{ width: `${percent}%` }} /></div>
                <div className="goal-meta"><span>{percent}% complete</span><span>{money(remaining, state)} left</span></div>
                <p className="goal-projection">{reachDate ? `At ${money(goal.monthlyContributionCents, state)}/month, you can reach it by ${reachDate.toLocaleDateString(state.settings.locale, { month: 'long', year: 'numeric' })}.` : 'Add a monthly contribution to see your estimated finish date.'}</p>
                <Button variant="primary" className="w-full" onClick={() => openGoalModal(goal, true)}>Add contribution</Button>
              </Card>
            )
          })}
        </div>
      ) : <Card className="p-6"><EmptyState title="Start your first goal" copy="Create a target for your emergency fund, holiday, or next big plan." action="Create goal" onAction={() => openGoalModal()} /></Card>}

      <Card className="p-5 md:p-6">
        <div className="section-heading"><div><h2>Savings over time</h2><p>Estimated household progress across all goals</p></div><CircleDollarSign size={21} /></div>
        <div className="mt-5 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={savingsChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E2D5" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6B7373' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#6B7373' }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value) => money(Math.round(Number(value) * 100), state)} />
              <Area type="monotone" dataKey="saved" name="Saved" stroke="#2F7D5B" fill="#DCECDF" strokeWidth={3} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </section>
  )

  const settingsView = (
    <section className="grid gap-5">
      <div className="page-heading">
        <div><p className="eyebrow">Make it yours</p><h1>Settings</h1><p>Household preferences, privacy, categories, and local data tools.</p></div>
      </div>
      <div className="settings-grid">
        <Card className="p-5 sync-settings-card">
          <div className="settings-card-title"><House size={20} /><div><h2>Sharing & sync</h2><p>Optional Supabase account and shared household.</p></div></div>
          <div className="mt-5"><Suspense fallback={<p>Loading sharing settings…</p>}><SharingPanel state={state} onStateChanged={(syncedState) => { stateRef.current = syncedState; setState(syncedState) }} /></Suspense></div>
        </Card>
        <Card className="p-5">
          <div className="settings-card-title"><Settings size={20} /><div><h2>Appearance & privacy</h2><p>Choose how HomeCoin looks on this device.</p></div></div>
          <div className="mt-5 grid gap-4">
            <Field label="Theme"><select className="select" value={state.settings.theme} onChange={(event) => applyTheme(event.target.value as ThemeMode)}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></Field>
            <label className="setting-toggle"><input type="checkbox" checked={state.settings.hideSensitiveValues} onChange={togglePrivacy} /><span><strong>Privacy mode</strong><small>Hide every money amount until you turn it off.</small></span></label>
          </div>
        </Card>
        <Card className="p-5">
          <div className="settings-card-title"><CalendarDays size={20} /><div><h2>Calendar & currency</h2><p>Control the way dates and money are shown.</p></div></div>
          <div className="mt-5 grid gap-4">
            <Field label="First day of the week"><select className="select" value={state.settings.weekStartDay} onChange={async (event) => { const day = Number(event.target.value); await commit((draft) => ({ ...draft, household: { ...draft.household, weekStartDay: day }, settings: { ...draft.settings, weekStartDay: day } })); setPlannerCycleOverride(null) }}>{WEEKDAY_OPTIONS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select></Field>
            <Field label="Currency"><select className="select" value={state.settings.currency} onChange={async (event) => { const currency = event.target.value; await commit((draft) => ({ ...draft, household: { ...draft.household, currency }, settings: { ...draft.settings, currency } })) }}>{CURRENCY_OPTIONS.map((currency) => <option key={currency}>{currency}</option>)}</select></Field>
          </div>
        </Card>
        <Card className="p-5">
          <div className="settings-card-title"><Landmark size={20} /><div><h2>Local data</h2><p>Your database never leaves this computer.</p></div></div>
          <div className="mt-5 grid gap-3"><Button variant="primary" onClick={exportBackup}>Export JSON backup</Button><Button variant="secondary" onClick={openSettingsFilePicker}>Import JSON backup</Button><Button variant="secondary" onClick={loadSampleHousehold}>Load sample household</Button></div>
          <input ref={fileInputRef} type="file" accept="application/json" hidden onChange={handleTransactionFileChange} />
        </Card>
        <Card className="p-5">
          <div className="settings-card-title"><WalletCards size={20} /><div><h2>Household</h2><p>People included in your shared plan.</p></div></div>
          <div className="mt-5 grid gap-3">{state.members.map((member) => <div key={member.id} className="member-row"><span className="member-avatar">{member.name.slice(0, 1).toUpperCase()}</span><span className="flex-1"><strong>{member.name}</strong><small>{member.role}</small></span><Button variant="ghost" onClick={() => removeMember(member)}>Remove</Button></div>)}</div>
          <div className="mt-4 flex gap-2"><input className="input" placeholder="Household member" value={newMemberName} onChange={(event) => setNewMemberName(event.target.value)} /><Button variant="primary" onClick={addMember}>Add</Button></div>
        </Card>
        <Card className="category-settings p-5">
          <div className="settings-card-title"><ReceiptText size={20} /><div><h2>Categories</h2><p>Create categories and pause the ones you no longer use.</p></div></div>
          <div className="category-manager mt-5">
            {state.categories.map((category) => (
              <button key={category.id} className="category-setting-pill" data-archived={category.archived} onClick={() => toggleCategory(category.id)} style={{ '--category-color': category.color } as React.CSSProperties}>
                <span />{category.name}<small>{category.archived ? 'Paused' : 'Active'}</small>
              </button>
            ))}
          </div>
          <div className="category-add mt-5">
            <input className="input" placeholder="New category" value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} />
            <select className="select" value={newCategoryKind} onChange={(event) => setNewCategoryKind(event.target.value as 'expense' | 'income')}><option value="expense">Expense</option><option value="income">Income</option></select>
            <Button variant="primary" onClick={addCategory}>Add category</Button>
          </div>
        </Card>
      </div>
    </section>
  )

  const reportRangeOptions = reportRange

  const plannerSection = (
    <section className="planner-section grid gap-5">
      <Card className="planner-toolbar p-5 print-hide">
        <div className="page-heading">
          <div><p className="eyebrow">Interactive household planning</p><h1>Planner</h1><p>{plannerLabel}</p></div>
          <div className="planner-toolbar-actions">
            <Button variant="secondary" onClick={() => moveInteractivePlannerCycle(-1)}>← Previous</Button>
            <Button variant="secondary" onClick={resetInteractivePlannerCycle}>Today</Button>
            <Button variant="secondary" onClick={() => moveInteractivePlannerCycle(1)}>Next →</Button>
            <Button variant="primary" onClick={() => openAddTransactionForDate(plannerCycle.plannerRange.start)}><Plus size={17} /> Add</Button>
            <Button variant="secondary" onClick={() => window.print()}><Printer size={17} /> Print</Button>
          </div>
        </div>
        <div className="planner-periods" aria-label="Planner periods">
          <span><small>Planner cycle</small><strong>{plannerCycleRangeLabel}</strong></span>
          <span><small>Next cycle starts</small><strong>{formatSimpleDay(plannerCycle.nextPlannerStart, state.settings.locale)}</strong></span>
        </div>
        <p className="planner-mode-note">Changes are saved immediately on this computer. Use Undo in the confirmation toast to restore the previous plan.</p>
      </Card>

      {plannerSelectedItem ? <div className="planner-item-popover print-hide" role="dialog" aria-label={`Actions for ${plannerSelectedItem.title}`}>
        <button className="planner-popover-close" onClick={() => setPlannerSelectedItem(null)} aria-label="Close item actions">×</button>
        <small>{plannerSelectedItem.kind === 'income' ? 'Income' : 'Bill'} · {formatSimpleDay(plannerSelectedItem.date, state.settings.locale)}</small>
        <h3>{plannerSelectedItem.title}</h3>
        <strong className={plannerSelectedItem.kind === 'income' ? 'money-positive' : 'money-negative'}>{money(plannerSelectedItem.amountCents, state)}</strong>
        <p>{state.categories.find((category) => category.id === plannerSelectedItem.categoryId)?.name ?? 'Uncategorised'} · {simpleStatusLabel(plannerSelectedItem.status)}</p>
        <div className="planner-popover-actions">
          <Button variant="ghost" onClick={() => { openEditTransaction(plannerSelectedItem); setPlannerSelectedItem(null) }}><Pencil size={15} /> Edit</Button>
          <Button variant="ghost" disabled={plannerSelectedItem.status === 'completed'} title={plannerSelectedItem.status === 'completed' ? 'Completed items can be changed from Edit.' : undefined} onClick={() => setPlannerMove({ item: plannerSelectedItem, targetDate: plannerSelectedItem.date, scope: 'occurrence' })}><Move size={15} /> Move</Button>
          <Button variant="ghost" onClick={() => setPlannerAmount({ item: plannerSelectedItem, amount: String(plannerSelectedItem.amountCents / 100), scope: 'occurrence' })}>Edit amount</Button>
          {plannerSelectedItem.status !== 'completed' ? <Button variant="primary" onClick={() => void completeItemFromPlanner(plannerSelectedItem)}>Mark {plannerSelectedItem.kind === 'income' ? 'received' : 'paid'}</Button> : null}
          <button className="delete-icon-button planner-delete-action" onClick={() => { setDeleteDialog({ kind: 'bills', items: [plannerSelectedItem] }); setPlannerSelectedItem(null) }}><Trash2 size={15} /> Delete</button>
        </div>
      </div> : null}

      <Card className="report-page report-planner planner-interactive overflow-hidden">
        <div className="report-header p-5 md:p-6">
          <div><p className="eyebrow">HomeCoin financial cycle</p><h2>{plannerLabel} Planner</h2></div>
          <span>Drag an item to another day, or click it for actions.</span>
        </div>
        <p className="report-planner-note">Adjacent days are shown to complete each week and calculate the balance correctly.</p>
        {mobileLayout ? <MobilePlannerView
          weeks={plannerWeeks}
          locale={state.settings.locale}
          money={(value) => money(value, state)}
          onSelectItem={setPlannerSelectedItem}
          onMoveToDate={openPlannerMove}
          onAddDay={openAddTransactionForDate}
        /> : <MonthlyPlannerView
          weeks={plannerWeeks}
          locale={state.settings.locale}
          money={(value) => money(value, state)}
          monthly
          interactive
          onMove={requestPlannerMove}
          onSelect={setPlannerSelectedItem}
          onAddDay={openAddTransactionForDate}
        />}
        <PlannerSavingsSummary accumulatedCents={savedTotal} actualCents={plannerActualSavings} plannedCents={plannerCycleSummary.savingsAllocationCents} periodLabel="cycle" goals={activeGoals} goalPlan={(value) => value} money={(value) => money(value, state)} />
        <MonthlyPlannerSummary
          mode="planner-cycle"
          cycleLabel={plannerCycleRangeLabel}
          totals={plannerCycleSummary}
          money={(value) => money(value, state)}
        />
        <div className="report-footer">HomeCoin • Interactive financial-cycle planning • {persistenceSyncLabel(cloudSync)}</div>
      </Card>
    </section>
  )

  const reportSection = (
    <section className="report-section grid gap-5">
      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-700">Reports</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Printable household planning</h1>
            <p className="mt-2 text-slate-600">See every day, what must be paid, what remains, and how much can go to savings.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="mobile-only" variant="secondary" onClick={() => setShowReportFilters(true)}>
              Filters
            </Button>
            <Button className="mobile-only" variant="secondary" onClick={() => setShowReportActions(true)}>
              Actions
            </Button>
            <Button className="desktop-report-action" variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
            <Button className="desktop-report-action" variant="secondary" onClick={savePdfReport}>
              Save PDF
            </Button>
            <Button className="desktop-report-action" variant="secondary" onClick={exportReportCsv}>
              Export CSV
            </Button>
          </div>
        </div>
      </Card>

      <Card className="report-configurator-card p-5">
        <div className="flex flex-wrap gap-2">
          {REPORT_PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              className="nav-pill"
              data-active={reportPeriod === option.value}
              onClick={() => setReportPeriod(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {reportPeriod !== 'custom' ? (
          <div className="report-period-navigator">
            <Button variant="secondary" onClick={() => moveReportPeriod(-1)}>← Previous</Button>
            <div><small>Planning period</small><strong>{reportRangeOptions.label}</strong></div>
            <Button variant="secondary" onClick={() => setReportReferenceDate(new Date())}>Today</Button>
            <Button variant="secondary" onClick={() => moveReportPeriod(1)}>Next →</Button>
          </div>
        ) : null}

        {reportPeriod === 'custom' ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Start date">
              <input className="input" type="date" value={reportStart} onChange={(event) => setReportStart(event.target.value)} />
            </Field>
            <Field label="End date">
              <input className="input" type="date" value={reportEnd} onChange={(event) => setReportEnd(event.target.value)} />
            </Field>
          </div>
        ) : null}

        <Field label="Report title" hint="Optional">
          <input className="input" value={reportTitle} onChange={(event) => setReportTitle(event.target.value)} />
        </Field>
      </Card>

      <div className="report-metrics-grid">
        <MetricCard label="Opening balance" value={money(reportOpeningBalance, state)} />
        <MetricCard label="Total income" value={money(reportRangeOptions.incomeCents, state)} />
        <MetricCard label="Bills to pay" value={money(reportRangeOptions.expenseCents, state)} />
        <MetricCard label="Income minus bills" value={money(reportRangeOptions.remainingCents, state)} />
        <MetricCard label="Savings still planned" value={money(reportSavingsStillPlanned, state)} />
        <MetricCard label={reportPeriod === 'month' ? 'Planner cycle closing balance' : 'Period closing balance'} value={money(reportProjectedClosingBalance, state)} highlight />
      </div>

      <Card className="p-5">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">{reportRangeOptions.label}</p>
        <p className="mt-3 text-xl font-semibold text-slate-900">{reportRangeOptions.message}</p>
        <div className="report-saving-strip">
          <span><small>Savings accumulated</small><strong>{money(savedTotal, state)}</strong></span>
          <span><small>Actually saved in this period</small><strong>{money(reportActualSavings, state)}</strong></span>
        </div>
      </Card>

      <Card className="report-page report-planner overflow-hidden">
        <div className="report-header p-5 md:p-6">
          <div><p className="eyebrow">HomeCoin — {reportRangeOptions.label}</p><h2>{reportTitle || 'Household planning report'}</h2></div>
          <span>Generated {new Intl.DateTimeFormat(state.settings.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}</span>
        </div>

        {reportPeriod === 'month' && planningWeeks.length ? (
          <p className="report-planner-note">Adjacent days are shown to complete each week and calculate the balance correctly.</p>
        ) : null}

        {planningWeeks.length ? (
          <MonthlyPlannerView weeks={planningWeeks} locale={state.settings.locale} money={(value) => money(value, state)} monthly={reportPeriod === 'month'} />
        ) : (
          <div className="table-wrap">
            <table className="data-table report-table">
              <thead><tr><th>Date</th><th>Name</th><th>Type</th><th>Status</th><th className="money-cell">Amount</th></tr></thead>
              <tbody>{reportItems.map((item) => <tr key={item.id}><td>{item.date}</td><td><strong>{item.title}</strong></td><td>{item.kind === 'income' ? 'Income' : 'Expense'}</td><td>{simpleStatusLabel(item.status)}</td><td className={`money-cell ${item.kind === 'income' ? 'money-positive' : 'money-negative'}`}>{item.kind === 'income' ? '+' : '−'}{money(item.amountCents, state)}</td></tr>)}</tbody>
            </table>
          </div>
        )}

        <PlannerSavingsSummary accumulatedCents={savedTotal} actualCents={reportActualSavings} plannedCents={reportPlannedSavings} periodLabel={reportPeriod === 'week' ? 'week' : reportPeriod === 'month' ? 'month' : 'period'} goals={activeGoals} goalPlan={savingsPlanForGoal} money={(value) => money(value, state)} />
        {reportPeriod === 'month' ? (
          <MonthlyPlannerSummary mode="calendar-report" monthName={reportMonthName} calendarMonthLabel={reportCalendarRangeLabel} plannerCycleLabel={reportPlannerRangeLabel} plannerCycleEndLabel={reportCycleEndLabel} incomeCents={reportRangeOptions.incomeCents} expenseCents={reportRangeOptions.expenseCents} remainingCents={reportPlannerMetrics?.calendarMonthResultCents ?? reportRangeOptions.remainingCents} openingBalanceCents={reportOpeningBalance} actualSavingsCents={reportActualSavings} closingBalanceCents={reportProjectedClosingBalance} distribution={reportDistribution} money={(value) => money(value, state)} />
        ) : null}
        <div className="report-footer">HomeCoin • Weekly and monthly household planning • Printed locally</div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-xl font-bold text-slate-900">Income and expenses by month</h2>
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={reportTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="incomeCents" name="Income" fill="#2F7D5B" radius={[8, 8, 0, 0]} />
                <Bar dataKey="expenseCents" name="Expenses" fill="#D97757" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-xl font-bold text-slate-900">Expense distribution</h2>
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={reportDistribution} dataKey="amountCents" nameKey="categoryName" innerRadius={72} outerRadius={108}>
                  {reportDistribution.map((entry, index) => (
                    <Cell key={entry.categoryId} fill={RESULT_COLORS[index % RESULT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-xl font-bold text-slate-900">Period summary</h2>
        <div className="mt-4 grid gap-3">
          {reportRangeOptions.topCategories.length > 0 ? (
            reportRangeOptions.topCategories.map((entry) => (
              <div key={entry.categoryId} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                <span className="font-medium text-slate-900">{entry.categoryName}</span>
                <span className="text-slate-600">{money(entry.amountCents, state)}</span>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-[color:var(--border)] bg-slate-50 px-4 py-8 text-center text-slate-500">
              No data for this period.
            </div>
          )}
        </div>
      </Card>

    </section>
  )

  const selectedCalendarDay = selectedDay ? calendarSnapshot.days.find((day) => day.date === selectedDay) ?? null : null

  return (
    <div className="app-shell">
      {!mobileLayout ? <aside className="app-sidebar print-hide">
        <div className="brand-mark"><span><House size={22} /></span><div><strong>HomeCoin</strong><small>Household finance</small></div></div>
        <DesktopNavigation activeSection={activeSection} onNavigate={setActiveSection} />
        <div className="sidebar-footer">
          <p>{new Intl.DateTimeFormat(state.settings.locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p>
          <span>{privateSyncLabel(cloudSync)}</span>
        </div>
      </aside> : null}

      <div className="app-content">
        <header className="app-topbar print-hide">
          <div>
            <strong>{SECTION_ITEMS.find((item) => item.key === activeSection)?.label}</strong>
            <span>{state.household.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={togglePrivacy} aria-label={visiblePrivacy ? 'Show money values' : 'Hide money values'}>
              {visiblePrivacy ? <EyeOff size={18} /> : <Eye size={18} />}{visiblePrivacy ? 'Hidden' : 'Visible'}
            </Button>
            <div className="quick-add-wrap">
              <Button variant="primary" aria-haspopup="menu" aria-expanded={showQuickAdd} onClick={() => setShowQuickAdd((visible) => !visible)}><Plus size={18} /> Add</Button>
              {showQuickAdd ? <div className="quick-add-menu" role="menu">
                <button role="menuitem" onClick={() => openQuickTransaction('income', 'Income')}><span className="quick-add-icon income"><CircleDollarSign size={17} /></span><span><strong>Income</strong><small>Salary or money received</small></span></button>
                <button role="menuitem" onClick={() => openQuickTransaction('bill', 'Expense')}><span className="quick-add-icon expense"><WalletCards size={17} /></span><span><strong>Expense</strong><small>Everyday spending</small></span></button>
                <button role="menuitem" onClick={() => openQuickTransaction('bill', 'Bill')}><span className="quick-add-icon bill"><ReceiptText size={17} /></span><span><strong>Bill</strong><small>Payment with a due date</small></span></button>
                <button role="menuitem" onClick={() => { setShowQuickAdd(false); const goal = state.goals.find((entry) => !entry.archived); if (goal) openGoalModal(goal, true); else openGoalModal() }}><span className="quick-add-icon savings"><Target size={17} /></span><span><strong>Savings contribution</strong><small>Add to a household goal</small></span></button>
              </div> : null}
            </div>
          </div>
        </header>

      <main className="app-frame pb-20 pt-6">
        {activeSection === 'dashboard' ? mobileLayout
          ? <MobileDashboard
              state={state}
              onEditItem={openEditTransaction}
              onAddIncome={() => openQuickTransaction('income', 'Income')}
              onAddBill={() => openQuickTransaction('bill', 'Expense')}
            />
          : dashboardView : null}
        {activeSection === 'planner' ? plannerSection : null}
        {activeSection === 'week' ? weekView : null}
        {activeSection === 'calendar' ? monthCalendar : null}
        {activeSection === 'recurring' ? accountsView : null}
        {activeSection === 'bills' ? billsView : null}
        {activeSection === 'savings' ? savingsView : null}
        {activeSection === 'reports' ? reportSection : null}
        {activeSection === 'settings' ? settingsView : null}
      </main>
      </div>

      {mobileLayout ? <MobileBottomNavigation activeSection={activeSection} onNavigate={setActiveSection} /> : null}

      {showReportFilters ? (
        <ModalShell title="Report filters" subtitle="Choose the planning period and report title." onClose={() => setShowReportFilters(false)}>
          <div className="grid gap-5">
            <div className="flex flex-wrap gap-2">
              {REPORT_PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className="nav-pill"
                  data-active={reportPeriod === option.value}
                  onClick={() => setReportPeriod(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {reportPeriod !== 'custom' ? (
              <div className="report-period-navigator">
                <Button variant="secondary" onClick={() => moveReportPeriod(-1)}>Previous</Button>
                <div><small>Planning period</small><strong>{reportRangeOptions.label}</strong></div>
                <Button variant="secondary" onClick={() => setReportReferenceDate(new Date())}>Today</Button>
                <Button variant="secondary" onClick={() => moveReportPeriod(1)}>Next</Button>
              </div>
            ) : null}

            {reportPeriod === 'custom' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Start date">
                  <input className="input" type="date" value={reportStart} onChange={(event) => setReportStart(event.target.value)} />
                </Field>
                <Field label="End date">
                  <input className="input" type="date" value={reportEnd} onChange={(event) => setReportEnd(event.target.value)} />
                </Field>
              </div>
            ) : null}

            <Field label="Report title" hint="Optional">
              <input className="input" value={reportTitle} onChange={(event) => setReportTitle(event.target.value)} />
            </Field>
            <Button variant="primary" onClick={() => setShowReportFilters(false)}>Apply filters</Button>
          </div>
        </ModalShell>
      ) : null}

      {showReportActions ? (
        <ModalShell title="Report actions" subtitle="Print or export the selected planning period." onClose={() => setShowReportActions(false)}>
          <div className="grid gap-3">
            <Button variant="primary" onClick={() => { setShowReportActions(false); window.print() }}>Print report</Button>
            <Button variant="secondary" onClick={() => { setShowReportActions(false); void savePdfReport() }}>Save PDF</Button>
            <Button variant="secondary" onClick={() => { setShowReportActions(false); exportReportCsv() }}>Export CSV</Button>
          </div>
        </ModalShell>
      ) : null}

      {plannerMove ? <ModalShell title="Move occurrence" subtitle={plannerMove.item.title} onClose={() => setPlannerMove(null)} className="max-w-md">
        <Field label="New date">
          <input className="input" type="date" aria-label="New date" value={plannerMove.targetDate} onChange={(event) => setPlannerMove((current) => current ? { ...current, targetDate: event.target.value } : current)} />
        </Field>
        {plannerMove.item.recurrenceRuleId ? <Field label="Apply to">
          <div className="planner-scope-options">
            <label><input type="radio" name="planner-move-scope" checked={plannerMove.scope === 'occurrence'} onChange={() => setPlannerMove((current) => current ? { ...current, scope: 'occurrence' } : current)} /> Only this occurrence</label>
            <label><input type="radio" name="planner-move-scope" checked={plannerMove.scope === 'series'} onChange={() => setPlannerMove((current) => current ? { ...current, scope: 'series' } : current)} /> This and following</label>
          </div>
        </Field> : null}
        <div className="mt-5 flex justify-end gap-3"><Button variant="secondary" onClick={() => setPlannerMove(null)}>Cancel</Button><Button variant="primary" onClick={confirmPlannerMove}>Move</Button></div>
      </ModalShell> : null}

      {plannerAmount ? <ModalShell title="Edit amount" subtitle={plannerAmount.item.title} onClose={() => setPlannerAmount(null)} className="max-w-md">
        <Field label={`Amount (${state.settings.currency})`}>
          <input className="input" inputMode="decimal" aria-label="Planner amount" value={plannerAmount.amount} onChange={(event) => setPlannerAmount((current) => current ? { ...current, amount: event.target.value } : current)} />
        </Field>
        {plannerAmount.item.recurrenceRuleId ? <Field label="Apply to">
          <div className="planner-scope-options">
            <label><input type="radio" name="planner-amount-scope" checked={plannerAmount.scope === 'occurrence'} onChange={() => setPlannerAmount((current) => current ? { ...current, scope: 'occurrence' } : current)} /> Only this occurrence</label>
            <label><input type="radio" name="planner-amount-scope" checked={plannerAmount.scope === 'series'} onChange={() => setPlannerAmount((current) => current ? { ...current, scope: 'series' } : current)} /> This and following</label>
          </div>
        </Field> : null}
        <div className="mt-5 flex justify-end gap-3"><Button variant="secondary" onClick={() => setPlannerAmount(null)}>Cancel</Button><Button variant="primary" onClick={confirmPlannerAmount}>Save amount</Button></div>
      </ModalShell> : null}

      {deleteDialog ? <ModalShell
        title={deleteDialog.kind === 'bills'
          ? deleteDialog.items.length === 1 ? 'Delete this bill?' : `Delete ${deleteDialog.items.length} bills?`
          : deleteDialog.rules.length === 1 ? 'Delete this recurring item?' : `Delete ${deleteDialog.rules.length} recurring items?`}
        onClose={() => setDeleteDialog(null)}
        className="delete-confirmation"
      >
        <div className="delete-confirmation-copy">
          {deleteDialog.kind === 'bills' ? (
            deleteDialog.items.length === 1
              ? <p><strong>“{deleteDialog.items[0].title}”</strong> — {dashboardMoney(deleteDialog.items[0].amountCents)} due {formatSimpleDay(deleteDialog.items[0].date, 'en-IE')} will be permanently removed.</p>
              : <p><strong>{deleteDialog.items.length} selected bills</strong> will be removed from your active bill list. Recorded history will be preserved.</p>
          ) : <>
            <p>{deleteDialog.rules.length === 1 ? <><strong>“{deleteDialog.rules[0].name}”</strong> will be permanently removed.</> : <><strong>{deleteDialog.rules.length} recurring items</strong> will be permanently removed.</>}</p>
            <p className="delete-warning-line">This will stop all future planned occurrences. Past transactions already recorded will stay in your history.</p>
          </>}
        </div>
        <div className="delete-confirmation-actions"><button className="delete-cancel-button" onClick={() => setDeleteDialog(null)}>Cancel</button><button className="delete-confirm-button" onClick={confirmDelete}><Trash2 size={17} /> Delete</button></div>
      </ModalShell> : null}

      {transactionModal ? (
        transactionModal.phase === 'choose' ? (
          <ModalShell
            title="Add item"
            subtitle="Choose whether money is coming in or going out."
            onClose={closeTransactionModal}
            className="max-w-md"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <button
                className="rounded-3xl border border-[color:var(--border)] bg-slate-50 p-5 text-left transition hover:-translate-y-0.5 hover:bg-emerald-50"
                onClick={() =>
                  setTransactionModal((current) =>
                    current
                      ? {
                          ...current,
                          phase: 'form',
                          draft: { ...current.draft, kind: 'income', recurrence: 'once' },
                        }
                      : current,
                  )
                }
              >
                <p className="text-lg font-bold text-slate-900">Income</p>
                <p className="mt-2 text-sm text-slate-500">Salary, freelance work, or any money coming in.</p>
              </button>
              <button
                className="rounded-3xl border border-[color:var(--border)] bg-slate-50 p-5 text-left transition hover:-translate-y-0.5 hover:bg-emerald-50"
                onClick={() =>
                  setTransactionModal((current) =>
                    current
                      ? {
                          ...current,
                          phase: 'form',
                          draft: { ...current.draft, kind: 'bill', recurrence: 'once' },
                        }
                      : current,
                  )
                }
              >
                <p className="text-lg font-bold text-slate-900">Bill</p>
                <p className="mt-2 text-sm text-slate-500">Rent, utilities, groceries, or another payment.</p>
              </button>
            </div>
          </ModalShell>
        ) : (
          <ModalShell
            title={transactionModal.source === 'new' ? 'Add item' : 'Edit item'}
            subtitle={transactionModal.source === 'recurring' ? 'Choose whether to update only this occurrence or the whole recurring series.' : 'Add only the details you need.'}
            onClose={closeTransactionModal}
          >
            {transactionModal.source === 'recurring' ? (
              <Field label="Apply changes to">
                <div className="entry-type-toggle edit-scope-toggle" role="group" aria-label="Apply changes to">
                  <button type="button" data-active={transactionModal.editScope === 'occurrence'} onClick={() => setTransactionModal((current) => current ? { ...current, editScope: 'occurrence' } : current)}>
                    <strong>This occurrence only</strong><small>Keeps the remaining schedule unchanged</small>
                  </button>
                  <button type="button" data-active={transactionModal.editScope === 'series'} onClick={() => setTransactionModal((current) => current ? { ...current, editScope: 'series' } : current)}>
                    <strong>Entire recurring series</strong><small>Updates this and all future occurrences</small>
                  </button>
                </div>
              </Field>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Type">
                <select
                  className="select"
                  value={transactionModal.draft.kind}
                  onChange={(event) =>
                    setTransactionModal((current) =>
                      current
                        ? {
                            ...current,
                            draft: {
                              ...current.draft,
                              kind: event.target.value as SimpleKind,
                              categoryId: defaultCategoryId(state, event.target.value as SimpleKind),
                            },
                          }
                        : current,
                    )
                  }
                >
                  <option value="income">Income</option>
                  <option value="bill">Bill</option>
                </select>
              </Field>
              <Field label="Name">
                <input
                  className="input"
                  aria-label="Name"
                  value={transactionModal.draft.title}
                  onChange={(event) =>
                    setTransactionModal((current) => (current ? { ...current, draft: { ...current.draft, title: event.target.value } } : current))
                  }
                />
              </Field>
              <Field label="Amount">
                <input
                  className="input"
                  aria-label="Amount"
                  inputMode="decimal"
                  value={transactionModal.draft.amount}
                  onChange={(event) =>
                    setTransactionModal((current) => (current ? { ...current, draft: { ...current.draft, amount: event.target.value } } : current))
                  }
                />
              </Field>
              <Field label="Category">
                <select
                  className="select"
                  aria-label="Category"
                  value={transactionModal.draft.categoryId}
                  onChange={(event) =>
                    setTransactionModal((current) =>
                      current ? { ...current, draft: { ...current.draft, categoryId: event.target.value } } : current,
                    )
                  }
                >
                  {state.categories
                    .filter((category) => !category.archived && (transactionModal.draft.kind === 'income' ? ['Income', 'Receitas'].includes(category.group) : !['Income', 'Receitas'].includes(category.group)))
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                </select>
              </Field>
              {transactionModal.allowRecurrence ? <div className="md:col-span-2">
                <Field label={transactionModal.draft.kind === 'bill' ? 'Bill type' : 'Income type'}>
                  <div className="entry-type-toggle" role="group" aria-label={transactionModal.draft.kind === 'bill' ? 'Bill type' : 'Income type'}>
                    <button type="button" data-active={transactionModal.draft.recurrence === 'once'} onClick={() => setTransactionModal((current) => current ? { ...current, draft: { ...current.draft, recurrence: 'once' } } : current)}>
                      <strong>{transactionModal.draft.kind === 'bill' ? 'One-time bill' : 'One-time income'}</strong><small>Creates one item on a specific date</small>
                    </button>
                    <button type="button" data-active={transactionModal.draft.recurrence !== 'once'} onClick={() => setTransactionModal((current) => current ? { ...current, draft: { ...current.draft, recurrence: 'monthly' } } : current)}>
                      <strong>{transactionModal.draft.kind === 'bill' ? 'Recurring bill' : 'Recurring income'}</strong><small>Creates a recurring schedule only</small>
                    </button>
                  </div>
                </Field>
              </div> : null}
              <Field label={transactionModal.source === 'recurring' && transactionModal.editScope === 'series' ? 'Next due date' : transactionModal.draft.recurrence === 'once' ? transactionModal.draft.kind === 'bill' ? 'Due date' : 'Date' : transactionModal.source === 'new' ? 'First occurrence' : 'Due date'}>
                <input
                  className="input"
                  aria-label={transactionModal.source === 'recurring' && transactionModal.editScope === 'series' ? 'Next due date' : transactionModal.draft.recurrence === 'once' ? transactionModal.draft.kind === 'bill' ? 'Due date' : 'Date' : transactionModal.source === 'new' ? 'First occurrence' : 'Due date'}
                  type="date"
                  value={transactionModal.draft.date}
                  onChange={(event) =>
                    setTransactionModal((current) => (current ? { ...current, draft: { ...current.draft, date: event.target.value } } : current))
                  }
                />
              </Field>
              {(transactionModal.allowRecurrence && transactionModal.draft.recurrence !== 'once') || (transactionModal.source === 'recurring' && transactionModal.editScope === 'series') ? (
                <Field label="Frequency">
                  <select
                    className="select"
                    value={transactionModal.draft.recurrence}
                    onChange={(event) =>
                      setTransactionModal((current) =>
                        current ? { ...current, draft: { ...current.draft, recurrence: event.target.value as RecurrenceChoice } } : current,
                      )
                    }
                  >
                    {Object.entries(FREQUENCY_LABELS).filter(([value]) => value !== 'once').map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
            </div>

            <details className="mt-4 rounded-2xl border border-[color:var(--border)] bg-slate-50 p-4">
              <summary className="cursor-pointer font-semibold text-slate-900">More options</summary>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field label="Account">
                  <select
                    className="select"
                    value={transactionModal.draft.accountId}
                    onChange={(event) =>
                      setTransactionModal((current) =>
                        current ? { ...current, draft: { ...current.draft, accountId: event.target.value } } : current,
                      )
                    }
                  >
                    {state.accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Person">
                  <select
                    className="select"
                    value={transactionModal.draft.personId}
                    onChange={(event) =>
                      setTransactionModal((current) =>
                        current ? { ...current, draft: { ...current.draft, personId: event.target.value } } : current,
                      )
                    }
                  >
                    <option value="">Optional</option>
                    {state.members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Notes">
                  <textarea
                    className="textarea"
                    value={transactionModal.draft.notes}
                    onChange={(event) =>
                      setTransactionModal((current) => (current ? { ...current, draft: { ...current.draft, notes: event.target.value } } : current))
                    }
                  />
                </Field>
              </div>
            </details>

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <Button variant="secondary" onClick={closeTransactionModal}>
                Cancel
              </Button>
              <Button variant="primary" onClick={saveTransaction}>
                Save
              </Button>
            </div>
          </ModalShell>
        )
      ) : null}

      {ruleModal ? (
        <ModalShell title={ruleModal.ruleId ? 'Edit recurring item' : 'Add recurring item'} subtitle="Use this to manage a future series." onClose={closeRuleModal}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Type">
              <select
                className="select"
                value={ruleModal.draft.kind}
                onChange={(event) =>
                  setRuleModal((current) =>
                    current
                      ? {
                          ...current,
                          draft: {
                            ...current.draft,
                            kind: event.target.value as SimpleKind,
                            categoryId: defaultCategoryId(state, event.target.value as SimpleKind),
                          },
                        }
                      : current,
                  )
                }
              >
                <option value="bill">Bill</option>
                <option value="income">Income</option>
              </select>
            </Field>
            <Field label="Name">
              <input
                className="input"
                value={ruleModal.draft.name}
                onChange={(event) =>
                  setRuleModal((current) => (current ? { ...current, draft: { ...current.draft, name: event.target.value } } : current))
                }
              />
            </Field>
            <Field label="Amount">
              <input
                className="input"
                inputMode="decimal"
                value={ruleModal.draft.amount}
                onChange={(event) =>
                  setRuleModal((current) => (current ? { ...current, draft: { ...current.draft, amount: event.target.value } } : current))
                }
              />
            </Field>
            <Field label="Next date">
              <input
                className="input"
                type="date"
                value={ruleModal.draft.nextDueDate}
                onChange={(event) =>
                  setRuleModal((current) => (current ? { ...current, draft: { ...current.draft, nextDueDate: event.target.value } } : current))
                }
              />
            </Field>
            <Field label="Frequency">
              <select
                className="select"
                value={ruleModal.draft.frequency}
                onChange={(event) =>
                  setRuleModal((current) =>
                    current ? { ...current, draft: { ...current.draft, frequency: event.target.value as RuleDraft['frequency'] } } : current,
                  )
                }
              >
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Biweekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </Field>
            <Field label="Account">
              <select
                className="select"
                value={ruleModal.draft.accountId}
                onChange={(event) =>
                  setRuleModal((current) => (current ? { ...current, draft: { ...current.draft, accountId: event.target.value } } : current))
                }
              >
                {state.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Category">
              <select
                className="select"
                value={ruleModal.draft.categoryId}
                onChange={(event) =>
                  setRuleModal((current) => (current ? { ...current, draft: { ...current.draft, categoryId: event.target.value } } : current))
                }
              >
                {state.categories
                  .filter((category) => !category.archived && (ruleModal.draft.kind === 'income' ? ['Income', 'Receitas'].includes(category.group) : !['Income', 'Receitas'].includes(category.group)))
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Person">
              <select
                className="select"
                value={ruleModal.draft.personId}
                onChange={(event) =>
                  setRuleModal((current) => (current ? { ...current, draft: { ...current.draft, personId: event.target.value } } : current))
                }
              >
                <option value="">Optional</option>
                {state.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Notes">
              <textarea
                className="textarea"
                value={ruleModal.draft.notes}
                onChange={(event) =>
                  setRuleModal((current) => (current ? { ...current, draft: { ...current.draft, notes: event.target.value } } : current))
                }
              />
            </Field>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={ruleModal.draft.active}
                onChange={(event) =>
                  setRuleModal((current) => (current ? { ...current, draft: { ...current.draft, active: event.target.checked } } : current))
                }
              />
              Active
            </label>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={closeRuleModal}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveRule}>
              Save
            </Button>
          </div>
        </ModalShell>
      ) : null}

      {goalModal ? (
        <ModalShell
          title={goalModal.contributionOnly ? 'Add contribution' : goalModal.goalId ? 'Edit savings goal' : 'New savings goal'}
          subtitle={goalModal.contributionOnly ? 'Every contribution moves the household plan forward.' : 'Set a clear target and a comfortable monthly pace.'}
          onClose={closeGoalModal}
        >
          {goalModal.contributionOnly ? (
            <Field label="Contribution amount">
              <input className="input" autoFocus inputMode="decimal" placeholder="0.00" value={goalModal.draft.currentAmount} onChange={(event) => setGoalModal((current) => current ? { ...current, draft: { ...current.draft, currentAmount: event.target.value } } : current)} />
            </Field>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Goal name"><input className="input" value={goalModal.draft.name} onChange={(event) => setGoalModal((current) => current ? { ...current, draft: { ...current.draft, name: event.target.value } } : current)} /></Field>
              <Field label="Target amount"><input className="input" inputMode="decimal" value={goalModal.draft.targetAmount} onChange={(event) => setGoalModal((current) => current ? { ...current, draft: { ...current.draft, targetAmount: event.target.value } } : current)} /></Field>
              <Field label="Already saved"><input className="input" inputMode="decimal" value={goalModal.draft.currentAmount} onChange={(event) => setGoalModal((current) => current ? { ...current, draft: { ...current.draft, currentAmount: event.target.value } } : current)} /></Field>
              <Field label="Monthly contribution"><input className="input" inputMode="decimal" value={goalModal.draft.monthlyContribution} onChange={(event) => setGoalModal((current) => current ? { ...current, draft: { ...current.draft, monthlyContribution: event.target.value } } : current)} /></Field>
              <Field label="Target date" hint="Optional"><input className="input" type="date" value={goalModal.draft.targetDate} onChange={(event) => setGoalModal((current) => current ? { ...current, draft: { ...current.draft, targetDate: event.target.value } } : current)} /></Field>
              <Field label="Notes" hint="Optional"><textarea className="textarea" value={goalModal.draft.notes} onChange={(event) => setGoalModal((current) => current ? { ...current, draft: { ...current.draft, notes: event.target.value } } : current)} /></Field>
            </div>
          )}
          <div className="mt-5 flex justify-end gap-3"><Button variant="secondary" onClick={closeGoalModal}>Cancel</Button><Button variant="primary" onClick={saveGoal}>{goalModal.contributionOnly ? 'Add contribution' : 'Save goal'}</Button></div>
        </ModalShell>
      ) : null}

      {showSettings ? (
        <SideDrawer title="Settings" subtitle="Quick preferences and local tools." onClose={() => setShowSettings(false)}>
          <div className="grid gap-5">
            <Card className="p-4">
              <h3 className="font-bold text-slate-900">Appearance & privacy</h3>
              <div className="mt-4 grid gap-4">
                <Field label="Theme">
                  <select
                    className="select"
                    value={state.settings.theme}
                    onChange={(event) => applyTheme(event.target.value as ThemeMode)}
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="system">System</option>
                  </select>
                </Field>
                <label className="flex items-center gap-2 rounded-2xl border border-[color:var(--border)] bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800">
                  <input
                    type="checkbox"
                    checked={state.settings.hideSensitiveValues}
                    onChange={togglePrivacy}
                  />
                  Privacy mode
                </label>
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-bold text-slate-900">Week & currency</h3>
              <div className="mt-4 grid gap-4">
                <Field label="First day of the week">
                  <select
                    className="select"
                    value={state.settings.weekStartDay}
                    onChange={async (event) => {
                      const day = Number(event.target.value)
                      await commit((draft) => ({
                        ...draft,
                        household: {
                          ...draft.household,
                          weekStartDay: day,
                        },
                        settings: {
                          ...draft.settings,
                          weekStartDay: day,
                        },
                      }))
                      setPlannerCycleOverride(null)
                    }}
                  >
                    {WEEKDAY_OPTIONS.map((day) => (
                      <option key={day.value} value={day.value}>
                        {day.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Currency">
                  <select
                    className="select"
                    value={state.settings.currency}
                    onChange={async (event) => {
                      await commit((draft) => ({
                        ...draft,
                        household: {
                          ...draft.household,
                          currency: event.target.value,
                        },
                        settings: {
                          ...draft.settings,
                          currency: event.target.value,
                        },
                      }))
                    }}
                  >
                    {CURRENCY_OPTIONS.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-bold text-slate-900">Household members</h3>
              <div className="mt-4 grid gap-3">
                {state.members.length > 0 ? (
                  state.members.map((member) => (
                    <div key={member.id} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                      <div>
                        <div className="font-semibold text-slate-900">{member.name}</div>
                        <div className="text-sm text-slate-500">{member.role}</div>
                      </div>
                      <Button variant="ghost" onClick={() => removeMember(member)}>
                        Remove
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-[color:var(--border)] bg-slate-50 px-4 py-6 text-center text-slate-500">
                    No household members yet.
                  </div>
                )}
              </div>
              <div className="mt-4 flex gap-2">
                <input
                  className="input"
                  placeholder="New member"
                  value={newMemberName}
                  onChange={(event) => setNewMemberName(event.target.value)}
                />
                <Button variant="primary" onClick={addMember}>
                  Add
                </Button>
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-bold text-slate-900">Local backup</h3>
              <p className="mt-2 text-sm text-slate-500">Backups are saved in Documents/HomeCoin/Backups.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" onClick={exportBackup}>
                  Export backup
                </Button>
                <Button variant="secondary" onClick={openSettingsFilePicker}>
                  Import backup
                </Button>
                <Button variant="secondary" onClick={loadSampleHousehold}>
                  Load sample data
                </Button>
              </div>
              <input ref={fileInputRef} type="file" accept="application/json" hidden onChange={handleTransactionFileChange} />
            </Card>
          </div>
        </SideDrawer>
      ) : null}

      {selectedCalendarDay ? (
        <SideDrawer
          title={formatSimpleDay(selectedCalendarDay.date, state.settings.locale)}
          subtitle="Income and bills for this day"
          onClose={() => setSelectedDay(null)}
        >
          <div className="grid gap-3">
            {selectedCalendarDay.items.length > 0 ? (
              selectedCalendarDay.items.map((item) => (
                <ItemRow key={item.id} item={item} state={state} onToggle={completeItem} onEdit={openEditTransaction} />
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-[color:var(--border)] bg-slate-50 px-4 py-8 text-center text-slate-500">
                No items on this day.
              </div>
            )}
          </div>
        </SideDrawer>
      ) : null}

      {toast ? <div className="app-toast" role="status"><span>{toast.message}</span>{toast.undo ? <button onClick={async () => { const undo = toast.undo; setToast(null); if (toastTimerRef.current) clearTimeout(toastTimerRef.current); if (undo) await undo() }}>Undo</button> : null}</div> : null}
    </div>
  )
}

export default App
