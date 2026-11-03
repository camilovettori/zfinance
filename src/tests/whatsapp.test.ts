import { describe, expect, it } from 'vitest'
import { localClock, parseReceipt, parseWhatsAppCommand, verifyMetaSignature } from '@/domain/whatsapp'
import { createDemoState } from '@/domain/seed'
import { recalculateAccountBalances } from '@/domain/calculations'
import { applyRemoteEntity, validateEntityPayload } from '@/sync/entities'
import type { Transaction } from '@/domain/model'

const valid = { total_amount: 4750, currency: 'EUR', date: '2026-11-03', merchant_name: 'Penneys', suggested_category: 'Shopping', items: [] }
describe('WhatsApp receipt validation', () => {
  it('accepts integer cents and rejects malformed, uncertain and foreign currency totals', () => {
    expect(parseReceipt(valid, 'EUR')).toEqual(valid)
    for (const data of [null, { ...valid, total_amount: 47.5 }, { ...valid, total_amount: -1 }, { ...valid, total_amount: 0 }, { ...valid, currency: 'USD' }, { ...valid, date: '2026-02-30' }, { ...valid, items: 'bad' }]) {
      expect(() => parseReceipt(data, 'EUR')).toThrow()
    }
  })
  it('parses exact cents and opt-out commands without interpreting arbitrary text as money', () => {
    expect(parseWhatsAppCommand('add €50,09 groceries')).toEqual({ kind: 'add', amountCents: 5009, category: 'groceries' })
    expect(parseWhatsAppCommand('adicionar 0.01 transport')).toEqual({ kind: 'add', amountCents: 1, category: 'transport' })
    expect(parseWhatsAppCommand(' STOP ')).toEqual({ kind: 'stop' })
    expect(parseWhatsAppCommand('desfazer')).toEqual({ kind: 'undo' })
    expect(parseWhatsAppCommand('add -50 groceries')).toEqual({ kind: 'help' })
    expect(parseWhatsAppCommand('add 5.001 groceries')).toEqual({ kind: 'help' })
  })
  it('uses Dublin wall time across summer and winter, independently of host timezone', () => {
    expect(localClock(new Date('2026-07-03T19:00:00Z'))).toEqual({ date: '2026-07-03', time: '20:00' })
    expect(localClock(new Date('2026-11-03T20:00:00Z'))).toEqual({ date: '2026-11-03', time: '20:00' })
  })
  it('verifies the exact raw webhook body and rejects forgery', async () => {
    const raw = '{"object":"whatsapp_business_account"}'
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', encoder.encode('test-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(raw)))
    const signature = `sha256=${Array.from(signed).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
    expect(await verifyMetaSignature(raw, signature, 'test-secret')).toBe(true)
    expect(await verifyMetaSignature(`${raw} `, signature, 'test-secret')).toBe(false)
    expect(await verifyMetaSignature(raw, signature, 'wrong-secret')).toBe(false)
    expect(await verifyMetaSignature(raw, null, 'test-secret')).toBe(false)
  })
  it('syncs a WhatsApp expense, debits the account once, and reverses it on cancellation', () => {
    const state = recalculateAccountBalances(createDemoState())
    const tx = validateEntityPayload<Transaction>('transactions', { ...state.transactions[0], id: 'whatsapp-test',
      type: 'expense', status: 'paid', source: 'whatsapp', amountCents: 4750, accountId: state.accounts[0].id })
    const remote = { id: tx.id, householdId: state.household.id, entityType: 'transactions' as const, payload: tx, version: 1, updatedAt: tx.updatedAt, createdAt: tx.createdAt, createdBy: 'test-user', updatedBy: 'test-user', clientUpdatedAt: tx.updatedAt, deletedAt: null }
    const once = recalculateAccountBalances(applyRemoteEntity(state, remote))
    const twice = recalculateAccountBalances(applyRemoteEntity(once, remote))
    expect(twice.accounts[0].currentBalanceCents).toBe(state.accounts[0].currentBalanceCents - 4750)
    const undone = recalculateAccountBalances(applyRemoteEntity(twice, { ...remote, version: 2, payload: { ...tx, status: 'cancelled' } }))
    expect(undone.accounts[0].currentBalanceCents).toBe(state.accounts[0].currentBalanceCents)
  })
})
