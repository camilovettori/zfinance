import type { AppState } from './model'
import { applyCamiloBalanceUpdate } from './camilo-balance'

export const applyRequestedCamiloUpdates = (state: AppState) => {
  const updated = applyCamiloBalanceUpdate(applyCamiloPlanUpdate(state))
  const matches = updated.recurringRules.filter((rule) => rule.active && rule.name.trim().toLowerCase() === 'remarkable iris'
    && rule.frequency === 'monthly' && rule.amountCents === 399)
  const keeper = matches.find((rule) => rule.nextDueDate.endsWith('-17'))
  const duplicates = keeper ? matches.filter((rule) => rule.nextDueDate.endsWith('-18') && rule.accountId === keeper.accountId) : []
  if (!duplicates.length) return updated
  const ids = new Set(duplicates.map((rule) => rule.id))
  return { ...updated, recurringRules: updated.recurringRules.map((rule) => ids.has(rule.id) ? { ...rule, active: false } : rule) }
}

// Requested plan change, effective November 2026. Match only Camilo's income;
// other household members and completed transactions retain their original data.
const salaryNames = new Set(['camilo wages', 'camilo wage', 'camilo salary'])

export function applyCamiloPlanUpdate(state: AppState): AppState {
  const salaries = state.recurringRules.filter((rule) => rule.active
    && salaryNames.has(rule.name.trim().toLowerCase())
    && ['Income', 'Receitas'].includes(state.categories.find((category) => category.id === rule.categoryId)?.group ?? ''))
  if (!salaries.length) return state

  const primary = salaries.find((rule) => rule.frequency === 'monthly') ?? salaries[0]
  const correctSalary = primary.name === 'Camilo Wage' && primary.frequency === 'monthly'
    && primary.interval === 1 && primary.amountCents === 288300
    && primary.nextDueDate.slice(-2) === '25' && primary.adjustToPrevFriday === true && !primary.endDate
  if (correctSalary && salaries.length === 1 && state.household.weekStartDay === 1 && state.settings.weekStartDay === 1) return state

  const salaryIds = new Set(salaries.map((rule) => rule.id))
  return {
    ...state,
    household: { ...state.household, weekStartDay: 1 },
    settings: { ...state.settings, weekStartDay: 1 },
    recurringRules: state.recurringRules.map((rule) => {
      if (rule.id === primary.id) return correctSalary ? rule : {
        ...rule, name: 'Camilo Wage', amountCents: 288300, frequency: 'monthly', interval: 1,
        nextDueDate: '2026-11-25', adjustToPrevFriday: true, endDate: undefined,
      }
      return salaryIds.has(rule.id) ? { ...rule, active: false } : rule
    }),
  }
}
