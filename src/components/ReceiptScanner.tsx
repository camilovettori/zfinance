import { useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { getSupabaseClient } from '@/sync/supabase-client'
import { useDialogAccessibility } from '@/lib/use-dialog-accessibility'
import { parseReceipt } from '@/domain/whatsapp'
import type { AppState, Transaction } from '@/domain/model'

export function ReceiptScanner({ state, onClose, onSave }: { state: AppState; onClose: () => void; onSave: (transaction: Transaction) => Promise<void> }) {
  const dialog = useRef<HTMLElement>(null)
  const transactionId = useRef(crypto.randomUUID())
  useDialogAccessibility(dialog, onClose)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [accountId, setAccountId] = useState(state.accounts.find((account) => !account.archived && account.currency === state.household.currency)?.id ?? '')
  const expenseCategories = state.categories.filter((category) => !category.archived && !['Income', 'Receitas'].includes(category.group))
  const [categoryId, setCategoryId] = useState(expenseCategories[0]?.id ?? '')
  const scan = async (file?: File) => {
    if (!file) return
    setError(''); setReady(false)
    if (file.size > 5_000_000 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Choose a JPG, PNG or WebP photo under 5 MB.'); return }
    const client = getSupabaseClient()
    if (!client) { setError('Sign in to cloud sync to scan receipts.'); return }
    setBusy(true)
    try {
      const form = new FormData(); form.append('image', file); form.append('householdId', state.household.id)
      const result = await client.functions.invoke('receipt-scan', { body: form })
      if (result.error) {
        const response = 'context' in result.error ? result.error.context : null
        let message = 'Could not scan this receipt. Check your connection and try again.'
        if (response instanceof Response) { try { message = (await response.json()).error ?? message } catch { /* Use the connection message. */ } }
        throw new Error(message)
      }
      const receipt = parseReceipt(result.data.receipt, state.household.currency)
      setName(receipt.merchant_name); setDate(receipt.date); setAmount((receipt.total_amount / 100).toFixed(2))
      setNotes(receipt.items.map((item) => `${item.name}: ${(item.amount_cents / 100).toFixed(2)}`).join('\n'))
      setCategoryId(expenseCategories.find((category) => category.name.toLowerCase() === receipt.suggested_category.toLowerCase())?.id ?? expenseCategories[0]?.id ?? '')
      setReady(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read this receipt.') } finally { setBusy(false) }
  }
  const save = async () => {
    if (!/^\d{1,7}([.,]\d{1,2})?$/.test(amount)) { setError('Enter a valid amount with up to two decimals.'); return }
    const [whole, fraction = ''] = amount.replace(',', '.').split('.')
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
    try {
      parseReceipt({ total_amount: cents, currency: state.household.currency, date, merchant_name: name.trim(), suggested_category: '', items: [] }, state.household.currency)
      if (!state.accounts.some((account) => account.id === accountId && !account.archived && account.currency === state.household.currency) || !expenseCategories.some((category) => category.id === categoryId)) throw new Error('Choose an account and expense category.')
      setBusy(true); setError('')
      const now = new Date().toISOString()
      await onSave({ id: transactionId.current, householdId: state.household.id, title: name.trim(), description: 'Receipt scanned and reviewed',
        amountCents: cents, type: 'expense', accountId, categoryId, transactionDate: date, paidDate: date, status: 'paid',
        source: 'manual', tags: ['receipt-scan'], notes, splits: [], createdAt: now, updatedAt: now })
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the expense.'); setBusy(false) }
  }
  return <div className="mobile-add-backdrop print-hide" role="presentation">
    <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="receipt-scan-title" className="receipt-scan-dialog">
      <header className="mobile-sheet-heading"><div><small>Photo to expense</small><h2 id="receipt-scan-title">Scan a receipt</h2></div><button type="button" aria-label="Close receipt scanner" disabled={busy} onClick={onClose}><X size={20} /></button></header>
      <p className="text-sm text-slate-500">Your photo is sent to Claude for extraction. Review the details before saving. HomeCoin does not store the image.</p>
      <label className="receipt-scan-upload"><Camera size={22} /><span>{busy ? 'Working…' : 'Take or choose a receipt photo'}</span><input aria-label="Receipt photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={(event) => { void scan(event.target.files?.[0]); event.target.value = '' }} /></label>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {ready ? <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <label>Merchant<input className="input" value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} /></label>
        <div className="grid grid-cols-2 gap-3"><label>Amount ({state.household.currency})<input className="input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label><label>Date<input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label></div>
        <label>Account<select className="select" value={accountId} onChange={(event) => setAccountId(event.target.value)} required>{state.accounts.filter((account) => !account.archived && account.currency === state.household.currency).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label>Category<select className="select" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>{expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <p className="text-sm text-slate-500">Saving records an already-paid expense and updates your balance.</p>
        <button className="mobile-add-primary min-h-12" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save paid expense'}</button>
      </form> : null}
      <button className="nav-pill min-h-11" type="button" disabled={busy} onClick={onClose}>Cancel</button>
    </section>
  </div>
}
