import type { AppState, RecurringRule, Transaction } from './model'

export type RemovedDuplicate = {
  transactionId: string
  transactionName: string
  recurringRuleId: string
  amountCents: number
  date: string
}

const normalizeName = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')

export const entryIdentity = (name: string, amountCents: number, date: string) =>
  `${normalizeName(name)}::${amountCents}::${date}`

export const isSamePlannedEntry = (
  name: string,
  amountCents: number,
  date: string,
  candidate: Pick<Transaction, 'title' | 'amountCents' | 'transactionDate' | 'status'>,
) =>
  candidate.status !== 'cancelled' &&
  entryIdentity(candidate.title, candidate.amountCents, candidate.transactionDate) === entryIdentity(name, amountCents, date)

export const isSameRecurringEntry = (
  name: string,
  amountCents: number,
  date: string,
  candidate: Pick<RecurringRule, 'name' | 'amountCents' | 'nextDueDate'>,
) => entryIdentity(candidate.name, candidate.amountCents, candidate.nextDueDate) === entryIdentity(name, amountCents, date)

export function cleanupOneOffRecurringDuplicates(state: AppState): {
  state: AppState
  removed: RemovedDuplicate[]
} {
  const recurringByIdentity = new Map<string, RecurringRule>()
  for (const rule of state.recurringRules) {
    recurringByIdentity.set(entryIdentity(rule.name, rule.amountCents, rule.nextDueDate), rule)
  }

  const removed: RemovedDuplicate[] = []
  const transactions = state.transactions.filter((transaction) => {
    if (
      transaction.recurrenceRuleId ||
      !['planned', 'pending', 'overdue'].includes(transaction.status) ||
      !['income', 'expense'].includes(transaction.type)
    ) {
      return true
    }

    const recurringRule = recurringByIdentity.get(
      entryIdentity(transaction.title, transaction.amountCents, transaction.transactionDate),
    )
    if (!recurringRule) {
      return true
    }

    removed.push({
      transactionId: transaction.id,
      transactionName: transaction.title,
      recurringRuleId: recurringRule.id,
      amountCents: transaction.amountCents,
      date: transaction.transactionDate,
    })
    return false
  })

  return {
    state: removed.length ? { ...state, transactions } : state,
    removed,
  }
}
