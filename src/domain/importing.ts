import Papa from 'papaparse'
import { toIsoDate } from '@/lib/date'
import type { AppState, ImportColumnMapping, ImportPreview, ImportPreviewRow, Transaction } from './model'
import { isDuplicateTransaction } from './calculations'

const sanitize = (value: string | undefined | null) => (value ?? '').trim()

const parseMoneyToCents = (raw: string) => {
  const normalized = raw
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=.*\.)/g, '')
    .replace(',', '.')

  if (!normalized || normalized === '-' || normalized === '.') {
    return null
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return Math.round(parsed * 100)
}

const parseDateValue = (value: string) => {
  const cleaned = value.trim()
  if (!cleaned) {
    return null
  }

  const ddmmyyyy = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy
    const year = Number(y.length === 2 ? `20${y}` : y)
    const month = Number(m)
    const day = Number(d)
    return toIsoDate(new Date(year, month - 1, day))
  }

  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    return cleaned.slice(0, 10)
  }

  const parsed = new Date(cleaned)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return toIsoDate(parsed)
}

const mapRow = (
  row: Record<string, string>,
  mapping: ImportColumnMapping,
  state: AppState,
  accountId: string,
  rowIndex: number,
): ImportPreviewRow => {
  const description = sanitize(row[mapping.description ?? ''])
  const date = parseDateValue(sanitize(row[mapping.date ?? '']))
  const debit = mapping.debit ? parseMoneyToCents(sanitize(row[mapping.debit])) : null
  const credit = mapping.credit ? parseMoneyToCents(sanitize(row[mapping.credit])) : null
  const value = mapping.value ? parseMoneyToCents(sanitize(row[mapping.value])) : null
  const reference = sanitize(row[mapping.reference ?? ''])
  const payee = sanitize(row[mapping.payee ?? ''])
  const currency = sanitize(row[mapping.currency ?? '']) || state.settings.currency

  let amountCents: number | null = null
  let type: Transaction['type'] = 'expense'

  if (value !== null) {
    amountCents = Math.abs(value)
    type = value >= 0 ? 'income' : 'expense'
  } else if (credit !== null || debit !== null) {
    if (credit !== null) {
      amountCents = credit
      type = 'income'
    } else if (debit !== null) {
      amountCents = Math.abs(debit)
      type = 'expense'
    }
  }

  const parsedTransaction: Partial<Transaction> | undefined =
    date && amountCents !== null && description
      ? {
          id: crypto.randomUUID(),
          householdId: state.household.id,
          title: description,
          description,
          amountCents,
          type,
          categoryId: state.categories.find((category) => ['Income', 'Receitas'].includes(category.group))?.id ?? state.categories[0].id,
          accountId,
          transactionDate: date,
          dueDate: date,
          paidDate: type === 'income' || type === 'expense' ? date : undefined,
          status: type === 'income' ? 'received' : 'paid',
          payee: payee || reference || undefined,
          paymentMethod: 'Import',
          tags: ['imported'],
          notes: currency,
          source: 'imported',
          splits: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      : undefined

  const duplicate = parsedTransaction ? isDuplicateTransaction(state, parsedTransaction as Transaction) : false
  const issue =
    parsedTransaction === undefined
      ? 'Linha inválida: data, descrição e valor são obrigatórios.'
      : duplicate
        ? 'Possível duplicata.'
        : undefined

  return {
    index: rowIndex,
    raw: row,
    parsed: parsedTransaction,
    duplicate,
    issue,
  }
}

export function parseCsvImport(
  text: string,
  mapping: ImportColumnMapping,
  state: AppState,
  accountId: string,
): ImportPreview {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  })

  const rows = (parsed.data ?? []).map((row: Record<string, string>, index: number) => mapRow(row, mapping, state, accountId, index + 1))

  return {
    rows,
    summary: {
      totalRows: rows.length,
      parsedRows: rows.filter((row) => Boolean(row.parsed)).length,
      duplicateRows: rows.filter((row) => row.duplicate).length,
      errorRows: rows.filter((row) => Boolean(row.issue) && !row.duplicate).length,
    },
  }
}

export function buildTransactionsFromImport(preview: ImportPreview) {
  return preview.rows
    .filter((row) => Boolean(row.parsed))
    .map((row) => row.parsed as Transaction)
}

export function parsePastedTable(text: string, state: AppState, accountId: string) {
  return parseCsvImport(text, {}, state, accountId)
}
