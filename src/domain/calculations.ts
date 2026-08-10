import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns'
import type {
  AppState,
  Budget,
  DashboardFilters,
  DashboardSummary,
  ForecastDay,
  FinancialGoal,
  Transaction,
  WeeklySummary,
} from './model'

const localDate = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

const toIsoDate = (date: Date) => format(date, 'yyyy-MM-dd')

const transactionCompleted = (transaction: Transaction) =>
  transaction.status === 'paid' ||
  transaction.status === 'received'

const activeTransaction = (transaction: Transaction) => transaction.status !== 'cancelled'

const transactionCashflow = (transaction: Transaction) => {
  if (!activeTransaction(transaction)) {
    return 0
  }

  if (transaction.type === 'income') {
    return transaction.amountCents
  }

  if (transaction.type === 'expense') {
    return -transaction.amountCents
  }

  if (transaction.type === 'adjustment') {
    return transaction.amountCents
  }

  return 0
}

const transactionAffectsBalances = (transaction: Transaction) =>
  activeTransaction(transaction) && transactionCompleted(transaction)

const accountEffect = (transaction: Transaction, accountId: string) => {
  if (!transactionAffectsBalances(transaction)) {
    return 0
  }

  if (transaction.type === 'transfer') {
    if (transaction.accountId === accountId) {
      return -transaction.amountCents
    }

    if (transaction.counterpartyAccountId === accountId) {
      return transaction.amountCents
    }

    return 0
  }

  if (transaction.accountId !== accountId) {
    return 0
  }

  return transactionCashflow(transaction)
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

const filterTransactions = (
  state: AppState,
  filters: DashboardFilters,
  includeFuture = false,
) => {
  const periodStart =
    filters.startDate ??
    (filters.period === 'year'
      ? toIsoDate(startOfMonth(subMonths(localDate(state.household.createdAt), 12)))
      : filters.period === 'quarter'
        ? toIsoDate(startOfMonth(subMonths(new Date(), 3)))
        : filters.period === 'custom'
          ? filters.startDate ?? state.transactions[0]?.transactionDate ?? toIsoDate(new Date())
          : toIsoDate(startOfMonth(new Date())))

  const periodEnd =
    filters.endDate ??
    (filters.period === 'year'
      ? toIsoDate(endOfMonth(new Date()))
      : filters.period === 'quarter'
        ? toIsoDate(endOfMonth(new Date()))
        : filters.period === 'custom'
          ? filters.endDate ?? toIsoDate(new Date())
          : toIsoDate(endOfMonth(new Date())))

  const start = localDate(periodStart)
  const end = localDate(periodEnd)

  return state.transactions.filter((transaction) => {
    if (!activeTransaction(transaction)) {
      return false
    }

    const date = localDate(transaction.transactionDate)
    if (isBefore(date, start) || isAfter(date, end)) {
      if (!includeFuture) {
        return false
      }
    }

    if (filters.accountId && transaction.accountId !== filters.accountId && transaction.counterpartyAccountId !== filters.accountId) {
      return false
    }

    if (filters.memberId && transaction.personId !== filters.memberId) {
      return false
    }

    if (filters.categoryId && transaction.categoryId !== filters.categoryId) {
      const splitMatch = transaction.splits.some((split) => split.categoryId === filters.categoryId)
      if (!splitMatch) {
        return false
      }
    }

    if (filters.status && filters.status !== 'all' && transaction.status !== filters.status) {
      return false
    }

    return true
  })
}

const categoryName = (state: AppState, categoryId: string) =>
  state.categories.find((category) => category.id === categoryId)?.name ?? 'Sem categoria'

const isRecurringTransaction = (transaction: Transaction) =>
  transaction.tags.includes('recorrente') || Boolean(transaction.recurrenceRuleId)

export function recalculateAccountBalances(state: AppState): AppState {
  const accounts = state.accounts.map((account) => ({
    ...account,
    currentBalanceCents: account.openingBalanceCents,
  }))

  for (const transaction of state.transactions) {
    for (const account of accounts) {
      account.currentBalanceCents += accountEffect(transaction, account.id)
    }
  }

  return {
    ...state,
    accounts,
  }
}

export function applyCategorizationRules(state: AppState, transaction: Transaction): Transaction {
  const candidateRules = state.categorizationRules
    .filter((rule) => rule.active)
    .sort((left, right) => right.priority - left.priority)

  const description = transaction.description.toUpperCase()
  const payee = (transaction.payee ?? '').toUpperCase()

  for (const rule of candidateRules) {
    if (rule.field === 'amount') {
      if (rule.operator === 'amountEquals' && Number(rule.pattern) === transaction.amountCents) {
        return { ...transaction, categoryId: rule.categoryId }
      }

      continue
    }

    const target =
      rule.field === 'description'
        ? description
        : rule.field === 'payee'
          ? payee
          : state.merchants.find((merchant) => merchant.normalizedName.includes(rule.pattern.toUpperCase()))?.normalizedName ??
            description

    const pattern = rule.pattern.toUpperCase()
    const matches =
      rule.operator === 'contains'
        ? target.includes(pattern)
        : rule.operator === 'equals'
          ? target === pattern
          : rule.operator === 'startsWith'
            ? target.startsWith(pattern)
            : false

    if (matches) {
      return { ...transaction, categoryId: rule.categoryId }
    }
  }

  return transaction
}

export function ensureCalculatedState(state: AppState): AppState {
  const withBalances = recalculateAccountBalances(state)
  return {
    ...withBalances,
    settings: {
      ...withBalances.settings,
      currency: withBalances.household.currency,
      locale: withBalances.household.locale,
      financialMonthStartDay: withBalances.household.financialMonthStartDay,
      weekStartDay: withBalances.household.weekStartDay,
    },
  }
}

const monthlyRange = (referenceDate: Date) => ({
  start: startOfMonth(referenceDate),
  end: endOfMonth(referenceDate),
})

function monthTotals(state: AppState, referenceDate: Date) {
  const { start, end } = monthlyRange(referenceDate)
  const monthlyTransactions = state.transactions.filter((transaction) => {
    if (!activeTransaction(transaction)) {
      return false
    }

    const date = localDate(transaction.transactionDate)
    return !isBefore(date, start) && !isAfter(date, end)
  })

  const income = sum(
    monthlyTransactions
      .filter((transaction) => transaction.type === 'income' && transactionCompleted(transaction))
      .map((transaction) => transaction.amountCents),
  )
  const expenses = sum(
    monthlyTransactions
      .filter((transaction) => transaction.type === 'expense' && transactionCompleted(transaction))
      .map((transaction) => transaction.amountCents),
  )
  const adjustments = sum(
    monthlyTransactions
      .filter((transaction) => transaction.type === 'adjustment' && transactionCompleted(transaction))
      .map((transaction) => transaction.amountCents),
  )

  return {
    monthlyTransactions,
    income,
    expenses,
    adjustments,
  }
}

function buildBalanceSeries(state: AppState, referenceDate: Date): Array<{ date: string; balanceCents: number }> {
  const start = addDays(referenceDate, -29)
  const series: Array<{ date: string; balanceCents: number }> = []

  for (let offset = 0; offset < 30; offset += 1) {
    const current = addDays(start, offset)
    let balance = sum(state.accounts.map((account) => account.openingBalanceCents))

    for (const transaction of state.transactions) {
      const transactionDate = localDate(transaction.transactionDate)
      if (isAfter(transactionDate, current)) {
        continue
      }

      for (const account of state.accounts) {
        balance += accountEffect(transaction, account.id)
      }
    }

    series.push({
      date: toIsoDate(current),
      balanceCents: balance,
    })
  }

  return series
}

function forecastRecurringFlows(state: AppState, fromDate: Date, toDate: Date) {
  const results: Array<{
    date: Date
    incomeCents: number
    expenseCents: number
    note?: string
  }> = []

  for (let current = fromDate; !isAfter(current, toDate); current = addDays(current, 1)) {
    let incomeCents = 0
    let expenseCents = 0
    const isoDate = toIsoDate(current)

    for (const rule of state.recurringRules.filter((entry) => entry.active)) {
      if (rule.endDate && isAfter(localDate(current.toISOString().slice(0, 10)), localDate(rule.endDate))) {
        continue
      }

      const due = localDate(rule.nextDueDate)
      if (!isSameDay(due, current)) {
        continue
      }

      if (rule.amountCents > 0) {
        if (['Income', 'Receitas'].includes(state.categories.find((category) => category.id === rule.categoryId)?.group ?? '')) {
          incomeCents += rule.amountCents
        } else {
          expenseCents += rule.amountCents
        }
      }
    }

    results.push({
      date: current,
      incomeCents,
      expenseCents,
      note: incomeCents || expenseCents ? `Recurring items on ${isoDate}` : undefined,
    })
  }

  return results
}

export function calculateForecast(state: AppState, referenceDate = new Date(), horizonDays = 30) {
  const currentBalance = sum(state.accounts.map((account) => account.currentBalanceCents))
  const history = state.transactions
    .filter((transaction) => activeTransaction(transaction))
    .filter((transaction) => isBefore(localDate(transaction.transactionDate), referenceDate) || isSameDay(localDate(transaction.transactionDate), referenceDate))

  const variableExpenses = history
    .filter((transaction) => transaction.type === 'expense' && !isRecurringTransaction(transaction))
    .map((transaction) => transaction.amountCents)

  const averageDailyExpense = variableExpenses.length
    ? Math.round(sum(variableExpenses) / Math.max(1, differenceInCalendarDays(referenceDate, startOfMonth(referenceDate)) + 1))
    : 0

  const recurringFlows = forecastRecurringFlows(state, referenceDate, addDays(referenceDate, horizonDays - 1))
  const projection: ForecastDay[] = []
  let runningBalance = currentBalance

  for (let offset = 0; offset < horizonDays; offset += 1) {
    const date = addDays(referenceDate, offset)
    const isoDate = toIsoDate(date)
    const dayFlow = recurringFlows.find((item) => isSameDay(item.date, date))
    const incomeCents = dayFlow?.incomeCents ?? 0
    const recurringExpenseCents = dayFlow?.expenseCents ?? 0
    const expenseCents = recurringExpenseCents + averageDailyExpense

    runningBalance += incomeCents - expenseCents

    projection.push({
      date: isoDate,
      projectedBalanceCents: runningBalance,
      incomeCents,
      expenseCents,
      recurringIncomeCents: incomeCents,
      recurringExpenseCents,
      note:
        runningBalance < 0
          ? 'Saldo projetado negativo.'
          : runningBalance < currentBalance * 0.25
            ? 'Ritmo conservador para acompanhar.'
            : undefined,
    })
  }

  const confidence =
    history.length > 60 ? 'high' : history.length > 20 ? 'medium' : 'low'

  return {
    currentBalance,
    recurringFlows,
    projection,
    confidence,
    method:
      'Projeção conservadora baseada em saldo atual, despesas variáveis médias e recorrências futuras confirmadas.',
    averageDailyExpense,
  }
}

export function calculateDashboardSummary(
  state: AppState,
  filters: DashboardFilters = { period: 'month', status: 'all' },
): DashboardSummary {
  const currentDate = new Date()
  const filtered = filterTransactions(state, filters, true)
  const totals = monthTotals(state, currentDate)
  const consolidatedBalanceCents = sum(state.accounts.map((account) => account.currentBalanceCents))

  const liquidAccountTypes = new Set(['current', 'joint', 'cash', 'savings', 'manual', 'investment'])
  const availableBalanceCents = sum(
    state.accounts
      .filter((account) => liquidAccountTypes.has(account.type))
      .map((account) => account.currentBalanceCents),
  )

  const dueSoon = filtered.filter((transaction) => {
    if (!transaction.dueDate || transaction.status === 'cancelled') {
      return false
    }

    const dueDate = localDate(transaction.dueDate)
    return differenceInCalendarDays(dueDate, currentDate) >= 0 && differenceInCalendarDays(dueDate, currentDate) <= 7
  })

  const overdueTransactions = state.transactions.filter((transaction) => {
    if (!transaction.dueDate || transaction.status === 'cancelled') {
      return false
    }

    return (
      transaction.type !== 'income' &&
      (transaction.status === 'pending' || transaction.status === 'planned' || transaction.status === 'overdue') &&
      isBefore(localDate(transaction.dueDate), currentDate)
    )
  })

  const categoryTotals = new Map<string, number>()
  for (const transaction of filtered) {
    if (transaction.type !== 'expense') {
      continue
    }

    categoryTotals.set(
      transaction.categoryId,
      (categoryTotals.get(transaction.categoryId) ?? 0) + transaction.amountCents,
    )

    for (const split of transaction.splits) {
      categoryTotals.set(split.categoryId, (categoryTotals.get(split.categoryId) ?? 0) + split.amountCents)
    }
  }

  const topCategories = [...categoryTotals.entries()]
    .map(([categoryId, amountCents]) => ({
      categoryId,
      categoryName: categoryName(state, categoryId),
      amountCents,
    }))
    .sort((left, right) => right.amountCents - left.amountCents)
    .slice(0, 5)

  const upcomingPayments = filtered
    .filter((transaction) => transaction.status !== 'cancelled' && transaction.type !== 'income')
    .filter((transaction) => Boolean(transaction.dueDate))
    .sort((left, right) => (left.dueDate ?? '').localeCompare(right.dueDate ?? ''))
    .slice(0, 6)

  const balanceSeries = buildBalanceSeries(state, currentDate)
  const projection = calculateForecast(state, currentDate, 30).projection

  const previousMonth = monthTotals(state, subMonths(currentDate, 1))
  const comparisonToPreviousMonthCents = totals.expenses - previousMonth.expenses

  const budgetLimit = state.budgets.find((budget) => budget.scope === 'general' && !budget.archived)?.limitCents ?? 0
  const budgetConsumedPercent = budgetLimit > 0 ? Math.round((totals.expenses / budgetLimit) * 100) : 0

  const cashRunwayMonths = totals.expenses > 0 ? Math.round((consolidatedBalanceCents / totals.expenses) * 10) / 10 : 0
  const alerts: string[] = []

  if (overdueTransactions.length > 0) {
    alerts.push(`${overdueTransactions.length} transações estão em atraso.`)
  }

  if (budgetConsumedPercent >= 85) {
    alerts.push('O orçamento mensal já está perto do limite.')
  }

  if (projection.at(-1)?.projectedBalanceCents !== undefined && projection.at(-1)!.projectedBalanceCents < 0) {
    alerts.push('A projeção indica saldo negativo até o fim do mês.')
  }

  const healthScore = Math.max(
    0,
    Math.min(
      100,
      78 -
        overdueTransactions.length * 15 -
        Math.max(0, budgetConsumedPercent - 70) * 0.5 +
        Math.min(12, cashRunwayMonths * 2),
    ),
  )

  const healthLabel =
    healthScore >= 80 ? 'Saudável' : healthScore >= 60 ? 'Estável' : healthScore >= 40 ? 'Atenção' : 'Crítico'

  return {
    consolidatedBalanceCents,
    availableBalanceCents,
    monthlyIncomeCents: totals.income,
    monthlyExpenseCents: totals.expenses,
    netResultCents: totals.income + totals.adjustments - totals.expenses,
    budgetConsumedPercent,
    accountsDueSoon: dueSoon,
    overdueTransactions,
    topCategories,
    upcomingPayments,
    balanceSeries,
    projection,
    comparisonToPreviousMonthCents,
    healthScore,
    healthLabel,
    alerts,
  }
}

export function calculateBudgetSummary(state: AppState) {
  const currentDate = new Date()
  const totals = monthTotals(state, currentDate)

  return state.budgets
    .filter((budget) => !budget.archived)
    .map((budget) => {
      const spent =
        budget.scope === 'general'
          ? totals.expenses
          : budget.scope === 'category' && budget.categoryId
            ? state.transactions
                .filter((transaction) => transaction.type === 'expense' && transactionCompleted(transaction))
                .filter((transaction) => transaction.categoryId === budget.categoryId)
                .map((transaction) => transaction.amountCents)
                .reduce((total, value) => total + value, 0)
            : budget.scope === 'person' && budget.personId
              ? state.transactions
                  .filter((transaction) => transaction.type === 'expense' && transactionCompleted(transaction))
                  .filter((transaction) => transaction.personId === budget.personId)
                  .map((transaction) => transaction.amountCents)
                  .reduce((total, value) => total + value, 0)
              : 0

      return {
        budget,
        spent,
        remaining: budget.limitCents - spent,
        consumedPercent: budget.limitCents > 0 ? Math.round((spent / budget.limitCents) * 100) : 0,
      }
    })
}

export function calculateGoalSummary(state: AppState) {
  return state.goals
    .filter((goal) => !goal.archived)
    .map((goal) => {
      const progressPercent = goal.targetCents > 0 ? Math.round((goal.currentCents / goal.targetCents) * 100) : 0
      const remaining = Math.max(0, goal.targetCents - goal.currentCents)
      const monthsLeft =
        goal.monthlyContributionCents > 0 ? Math.ceil(remaining / goal.monthlyContributionCents) : undefined

      return {
        goal,
        progressPercent,
        remaining,
        estimatedCompletion:
          monthsLeft && goal.targetDate
            ? format(addMonths(parseISO(goal.targetDate), -Math.max(0, monthsLeft - 1)), 'yyyy-MM-dd')
            : undefined,
        monthsLeft,
      }
    })
}

export function buildCalendarMonth(state: AppState, monthDate = new Date()) {
  const start = startOfWeek(startOfMonth(monthDate), { weekStartsOn: state.settings.weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 })
  const end = endOfWeek(endOfMonth(monthDate), { weekStartsOn: state.settings.weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 })
  const days: Array<{
    date: string
    transactions: Transaction[]
    balanceCents: number
    inMonth: boolean
  }> = []

  for (let current = start; !isAfter(current, end); current = addDays(current, 1)) {
    const isoDate = toIsoDate(current)
    const transactions = state.transactions.filter((transaction) => transaction.transactionDate === isoDate && activeTransaction(transaction))
    const balanceCents = state.accounts.reduce((total, account) => total + account.currentBalanceCents, 0)
    days.push({
      date: isoDate,
      transactions,
      balanceCents,
      inMonth: current.getMonth() === monthDate.getMonth(),
    })
  }

  return days
}

export function buildWeeklySummary(state: AppState, referenceDate = new Date()): WeeklySummary {
  const weekStart = startOfWeek(referenceDate, { weekStartsOn: state.settings.weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 })
  const weekEnd = endOfWeek(referenceDate, { weekStartsOn: state.settings.weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 })
  const previousWeekStart = subWeeks(weekStart, 1)
  const previousWeekEnd = subWeeks(weekEnd, 1)

  const currentWeekTransactions = state.transactions.filter((transaction) => {
    if (!activeTransaction(transaction)) {
      return false
    }

    const date = localDate(transaction.transactionDate)
    return !isBefore(date, weekStart) && !isAfter(date, weekEnd)
  })

  const previousWeekTransactions = state.transactions.filter((transaction) => {
    if (!activeTransaction(transaction)) {
      return false
    }

    const date = localDate(transaction.transactionDate)
    return !isBefore(date, previousWeekStart) && !isAfter(date, previousWeekEnd)
  })

  const income = currentWeekTransactions
    .filter((transaction) => transaction.type === 'income' && transactionCompleted(transaction))
    .reduce((total, transaction) => total + transaction.amountCents, 0)
  const expense = currentWeekTransactions
    .filter((transaction) => transaction.type === 'expense' && transactionCompleted(transaction))
    .reduce((total, transaction) => total + transaction.amountCents, 0)

  const topCategories = new Map<string, number>()
  for (const transaction of currentWeekTransactions.filter((entry) => entry.type === 'expense')) {
    topCategories.set(
      transaction.categoryId,
      (topCategories.get(transaction.categoryId) ?? 0) + transaction.amountCents,
    )
  }

  const largestTransactions = [...currentWeekTransactions]
    .sort((left, right) => right.amountCents - left.amountCents)
    .slice(0, 5)

  const paidBills = currentWeekTransactions.filter((transaction) => transaction.status === 'paid')
  const pendingBills = currentWeekTransactions.filter((transaction) =>
    ['pending', 'planned', 'overdue'].includes(transaction.status),
  )
  const nextWeekBills = state.transactions.filter((transaction) => {
    if (!transaction.dueDate || transaction.status === 'cancelled') {
      return false
    }

    const due = localDate(transaction.dueDate)
    return isAfter(due, weekEnd) && differenceInCalendarDays(due, weekEnd) <= 7
  })

  const comparisonToPreviousWeekCents =
    expense -
    previousWeekTransactions
      .filter((transaction) => transaction.type === 'expense' && transactionCompleted(transaction))
      .reduce((total, transaction) => total + transaction.amountCents, 0)

  const projectedEndOfMonthCents = calculateForecast(state, referenceDate, differenceInCalendarDays(endOfMonth(referenceDate), referenceDate) + 1).projection.at(-1)
    ?.projectedBalanceCents ?? 0

  const actions: WeeklySummary['actions'] = []
  const restaurantCategory = state.categories.find((category) => category.name === 'Restaurantes')
  const restaurantSpend = restaurantCategory
    ? currentWeekTransactions
        .filter((transaction) => transaction.categoryId === restaurantCategory.id)
        .reduce((total, transaction) => total + transaction.amountCents, 0)
    : 0
  const previousRestaurantAverage = restaurantCategory
    ? state.transactions
        .filter((transaction) => transaction.categoryId === restaurantCategory.id && transaction.type === 'expense')
        .slice(-4)
        .reduce((total, transaction) => total + transaction.amountCents, 0) / 4
    : 0

  if (restaurantCategory && previousRestaurantAverage > 0 && restaurantSpend > previousRestaurantAverage * 1.25) {
    actions.push({
      title: 'Restaurantes acima da média',
      reason: `Os gastos em restaurantes estão ${Math.round((restaurantSpend / previousRestaurantAverage - 1) * 100)}% acima da média das últimas quatro semanas.`,
    })
  }

  if (nextWeekBills.length >= 3) {
    actions.push({
      title: 'Vários pagamentos previstos',
      reason: `Existem ${nextWeekBills.length} pagamentos previstos antes da próxima receita.`,
    })
  }

  if (projectedEndOfMonthCents < 0) {
    actions.push({
      title: 'Saldo projetado negativo',
      reason: 'O saldo projetado ficará abaixo de zero até o fim do mês.',
    })
  }

  if (actions.length === 0) {
    actions.push({
      title: 'Semana sob controlo',
      reason: 'Não há alertas críticos no período analisado.',
    })
  }

  return {
    rangeStart: toIsoDate(weekStart),
    rangeEnd: toIsoDate(weekEnd),
    incomeCents: income,
    expenseCents: expense,
    resultCents: income - expense,
    topCategories: [...topCategories.entries()]
      .map(([categoryId, amountCents]) => ({
        categoryId,
        categoryName: categoryName(state, categoryId),
        amountCents,
      }))
      .sort((left, right) => right.amountCents - left.amountCents)
      .slice(0, 5),
    largestTransactions,
    paidBills,
    pendingBills,
    nextWeekBills,
    comparisonToPreviousWeekCents,
    projectedEndOfMonthCents,
    actions,
  }
}

export function getBudgetProgress(budget: Budget, state: AppState) {
  return calculateBudgetSummary(state).find((entry) => entry.budget.id === budget.id)
}

export function getFinancialGoalProgress(goal: FinancialGoal) {
  const progressPercent = goal.targetCents > 0 ? Math.round((goal.currentCents / goal.targetCents) * 100) : 0
  return {
    goal,
    progressPercent,
    remainingCents: Math.max(0, goal.targetCents - goal.currentCents),
  }
}

export function getMonthlyTransactionWindow(state: AppState, referenceDate = new Date()) {
  const { start, end } = monthlyRange(referenceDate)
  return state.transactions.filter((transaction) => {
    const date = localDate(transaction.transactionDate)
    return !isBefore(date, start) && !isAfter(date, end)
  })
}

export function isDuplicateTransaction(state: AppState, candidate: Transaction) {
  return state.transactions.some(
    (transaction) =>
      transaction.id !== candidate.id &&
      transaction.transactionDate === candidate.transactionDate &&
      transaction.amountCents === candidate.amountCents &&
      transaction.accountId === candidate.accountId &&
      transaction.description.toUpperCase() === candidate.description.toUpperCase(),
  )
}

export function inferHealthLabel(score: number) {
  if (score >= 80) {
    return 'Saudável'
  }

  if (score >= 60) {
    return 'Estável'
  }

  if (score >= 40) {
    return 'Atenção'
  }

  return 'Crítico'
}
