import { describe, expect, it } from 'vitest'
import { parseCsvImport } from '@/domain/importing'
import { createDemoState } from '@/domain/seed'

describe('csv import', () => {
  it('detects basic rows and duplicates', () => {
    const state = createDemoState()
    const accountId = state.accounts[0].id
    state.transactions = [
      {
        id: 'tx-1',
        householdId: state.household.id,
        title: 'TESCO',
        description: 'TESCO',
        amountCents: 25_00,
        type: 'expense',
        categoryId: state.categories[0].id,
        accountId,
        transactionDate: '2026-08-01',
        dueDate: '2026-08-01',
        status: 'paid',
        tags: [],
        notes: '',
        source: 'manual',
        splits: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]

    const csv = `date,description,value
2026-08-01,TESCO,-25.00
2026-08-02,Salary,3000.00`
    const preview = parseCsvImport(csv, { date: 'date', description: 'description', value: 'value' }, state, accountId)

    expect(preview.summary.totalRows).toBe(2)
    expect(preview.summary.parsedRows).toBe(2)
    expect(preview.summary.duplicateRows).toBe(1)
    expect(preview.rows[0].duplicate).toBe(true)
  })
})
