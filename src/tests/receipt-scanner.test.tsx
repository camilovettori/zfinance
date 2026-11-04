import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ReceiptScanner } from '@/components/ReceiptScanner'
import { createDemoState } from '@/domain/seed'
import { getSupabaseClient } from '@/sync/supabase-client'

vi.mock('@/sync/supabase-client', () => ({ getSupabaseClient: vi.fn() }))
const receipt = { total_amount: 4750, currency: 'EUR', date: '2026-11-04', merchant_name: 'Test Store', suggested_category: 'Groceries', items: [] }
function setup() {
  const state = createDemoState(); state.household.currency = 'EUR'; state.accounts[0].currency = 'EUR'
  const invoke = vi.fn().mockResolvedValue({ data: { receipt }, error: null })
  vi.mocked(getSupabaseClient).mockReturnValue({ functions: { invoke } } as unknown as NonNullable<ReturnType<typeof getSupabaseClient>>)
  const onSave = vi.fn().mockResolvedValue(undefined); const onClose = vi.fn()
  render(<ReceiptScanner state={state} onClose={onClose} onSave={onSave} />)
  return { invoke, onSave, onClose, user: userEvent.setup() }
}
describe('receipt review', () => {
  it('requires review, saves edited integer cents and reuses the transaction id on retry', async () => {
    const { user, onSave, onClose, invoke } = setup()
    onSave.mockRejectedValueOnce(new Error('Connection interrupted'))
    await user.upload(screen.getByLabelText('Receipt photo'), new File(['fake-test-image'], 'receipt.png', { type: 'image/png' }))
    await screen.findByLabelText('Merchant')
    expect(onSave).not.toHaveBeenCalled()
    expect(invoke.mock.calls[0][1].body).toBeInstanceOf(FormData)
    await user.clear(screen.getByLabelText('Amount (EUR)')); await user.type(screen.getByLabelText('Amount (EUR)'), '0.01')
    await user.click(screen.getByRole('button', { name: 'Save paid expense' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Save paid expense' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    expect(onSave.mock.calls[0][0]).toMatchObject({ amountCents: 1, status: 'paid', type: 'expense', title: 'Test Store', transactionDate: '2026-11-04' })
    expect(onSave.mock.calls[0][0].id).toBe(onSave.mock.calls[1][0].id)
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('keeps the account unchanged when extraction fails', async () => {
    const { user, onSave, invoke } = setup()
    invoke.mockResolvedValueOnce({ data: { receipt: { ...receipt, total_amount: 0 } }, error: null })
    await user.upload(screen.getByLabelText('Receipt photo'), new File(['bad'], 'receipt.png', { type: 'image/png' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: 'Save paid expense' })).toBeNull()
    expect(onSave).not.toHaveBeenCalled()
  })
})
