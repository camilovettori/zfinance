export interface ReceiptData {
  total_amount: number
  currency: string
  date: string
  merchant_name: string
  suggested_category: string
  items: Array<{ name: string; amount_cents: number }>
}

export function parseReceipt(value: unknown, currency: string): ReceiptData {
  if (!value || typeof value !== 'object') throw new Error('Receipt could not be read. Try a clearer photo.')
  const receipt = value as ReceiptData
  const date = new Date(`${receipt.date}T12:00:00Z`)
  if (!Number.isSafeInteger(receipt.total_amount) || receipt.total_amount <= 0 || receipt.total_amount > 100_000_000
    || receipt.currency !== currency || !/^\d{4}-\d{2}-\d{2}$/.test(receipt.date)
    || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== receipt.date
    || typeof receipt.merchant_name !== 'string' || !receipt.merchant_name.trim() || receipt.merchant_name.length > 160
    || typeof receipt.suggested_category !== 'string' || receipt.suggested_category.length > 80
    || !Array.isArray(receipt.items) || receipt.items.length > 100
    || receipt.items.some((item) => !item || typeof item.name !== 'string' || item.name.length > 160 || !Number.isSafeInteger(item.amount_cents))) {
    throw new Error('Receipt has an invalid total, date or currency. No expense was added.')
  }
  return receipt
}

export type WhatsAppCommand = { kind: 'balance' | 'week' | 'tomorrow' | 'help' | 'undo' | 'stop' | 'start' }
  | { kind: 'add'; amountCents: number; category: string }

export function parseWhatsAppCommand(text: string): WhatsAppCommand {
  const normalized = text.trim().toLowerCase()
  const commands: Record<string, WhatsAppCommand['kind']> = {
    balance: 'balance', saldo: 'balance', 'this week': 'week', semana: 'week', tomorrow: 'tomorrow',
    amanhã: 'tomorrow', amanha: 'tomorrow', help: 'help', ajuda: 'help', undo: 'undo', desfazer: 'undo',
    stop: 'stop', parar: 'stop', start: 'start', iniciar: 'start',
  }
  if (commands[normalized]) return { kind: commands[normalized] } as WhatsAppCommand
  const add = /^(?:add|adicionar)\s+€?\s*(\d{1,6}(?:[.,]\d{1,2})?)\s+(.{1,80})$/i.exec(text.trim())
  if (add) {
    const [whole, fraction = ''] = add[1].replace(',', '.').split('.')
    const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
    if (amountCents > 0 && amountCents <= 100_000_000) return { kind: 'add', amountCents, category: add[2].trim() }
  }
  return { kind: 'help' }
}

export function localClock(now: Date, timezone = 'Europe/Dublin') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? ''
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` }
}

export async function verifyMetaSignature(raw: string, signature: string | null, secret: string) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const bytes = new Uint8Array(signature.slice(7).match(/../g)!.map((hex) => parseInt(hex, 16)))
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(raw))
}
