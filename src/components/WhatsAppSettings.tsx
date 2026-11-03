import { useEffect, useState } from 'react'
import { MessageCircle, RefreshCw } from 'lucide-react'
import type { AppState } from '@/domain/model'
import { getSupabaseClient } from '@/sync/supabase-client'

interface Contact { id: string; member_name: string; phone_number: string; notifications_enabled: boolean; reminder_time: string; verified_at: string | null; link_code: string; link_expires_at: string }
interface Scan { id: string; created_at: string; status: string; reply: string | null; transaction_id: string | null }
export function WhatsAppSettings({ state }: { state: AppState }) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [scans, setScans] = useState<Scan[]>([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [account, setAccount] = useState(state.accounts.find((item) => !item.archived && item.currency === state.household.currency)?.id ?? '')
  const [category, setCategory] = useState(state.categories.find((item) => !item.archived && !['Income', 'Receitas'].includes(item.group))?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [available, setAvailable] = useState(false)
  const [consent, setConsent] = useState(false)
  const client = getSupabaseClient()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!client) return
      const result = await client.from('whatsapp_contacts').select('*').eq('household_id', state.household.id)
      if (cancelled) return
      if (result.error) { setError('WhatsApp setup is pending. Connect the HomeCoin business number to enable this feature.'); return }
      setAvailable(true); setContacts(result.data as Contact[])
      const history = await client.from('whatsapp_messages').select('id,created_at,status,reply,transaction_id').eq('household_id', state.household.id).eq('message_type', 'image').order('created_at', { ascending: false }).limit(10)
      if (!cancelled && !history.error) setScans(history.data as Scan[])
    })()
    return () => { cancelled = true }
  }, [client, state.household.id])

  const refresh = async () => {
    if (!client) return
    const result = await client.from('whatsapp_contacts').select('*').eq('household_id', state.household.id)
    if (result.error) throw new Error(result.error.message)
    setContacts(result.data as Contact[])
    const history = await client.from('whatsapp_messages').select('id,created_at,status,reply,transaction_id').eq('household_id', state.household.id).eq('message_type', 'image').order('created_at', { ascending: false }).limit(10)
    if (history.error) throw new Error(history.error.message)
    setScans(history.data as Scan[])
  }
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action(); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save WhatsApp settings.') } finally { setBusy(false) }
  }
  const save = async () => {
    const normalized = phone.replace(/[+\s()-]/g, '')
    if (!/^[1-9]\d{7,14}$/.test(normalized)) throw new Error('Enter an international number, for example +353…')
    if (!name.trim() || !account || !category || !consent) throw new Error('Complete all fields and confirm consent.')
    const result = await client!.from('whatsapp_contacts').insert({ household_id: state.household.id, member_name: name.trim(), phone_number: normalized, account_id: account, category_id: category })
    if (result.error) throw new Error(result.error.code === '23505' ? 'This number is already registered.' : result.error.message)
    setPhone(''); setName(''); setConsent(false)
  }
  return <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:bg-slate-900" aria-labelledby="whatsapp-title">
    <div className="settings-card-title"><MessageCircle size={22} /><div><h2 id="whatsapp-title">WhatsApp assistant</h2><p>Receipt photos, quick expenses and daily reminders.</p></div></div>
    <p className="mt-3 text-sm text-slate-500">Link your own number, then send <strong>help</strong> to the HomeCoin business number. No credentials are stored in this app.</p>
    {!client ? <p className="mt-3">Sign in to cloud sync to connect WhatsApp.</p> : null}
    {error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}
    {available ? <div className="mt-4 grid gap-4">
      {contacts.map((contact) => <article key={contact.id} className="rounded-xl border border-stone-200 p-4">
        <strong>{contact.member_name}</strong><p>+{contact.phone_number} · {contact.verified_at ? 'Connected' : 'Awaiting verification'}</p>
        {!contact.verified_at ? <p className="mt-2 break-all text-sm">Send <code>link {contact.link_code}</code> from this number to the HomeCoin WhatsApp number. Expires: {new Date(contact.link_expires_at).toLocaleTimeString(state.settings.locale)}. If expired, disconnect and link again.</p> : <>
          <label className="setting-toggle mt-3"><input type="checkbox" checked={contact.notifications_enabled} disabled={busy} onChange={(event) => { const enabled = event.target.checked; void run(async () => { const result = await client!.from('whatsapp_contacts').update({ notifications_enabled: enabled }).eq('id', contact.id); if (result.error) throw result.error }) }} /><span>Daily reminders (Europe/Dublin)</span></label>
          <label className="mt-3 block text-sm">Reminder time<input type="time" className="input mt-1" aria-label={`Reminder time for ${contact.member_name}`} value={contact.reminder_time.slice(0, 5)} disabled={busy} onChange={(event) => { const time = event.target.value; if (time) void run(async () => { const result = await client!.from('whatsapp_contacts').update({ reminder_time: time }).eq('id', contact.id); if (result.error) throw result.error }) }} /></label>
          <p className="mt-2 text-sm text-slate-500">To test: send <strong>balance</strong> in WhatsApp. Reply STOP anytime to stop reminders.</p>
          <button type="button" className="nav-pill mt-3 min-h-11" disabled={busy} onClick={() => void run(async () => { const result = await client!.functions.invoke('whatsapp-test', { body: { contactId: contact.id } }); if (result.error) throw new Error('Test failed. Send help from WhatsApp first and check server configuration.') })}>Send test message</button>
        </>}
        <button type="button" className="nav-pill mt-3 min-h-11" disabled={busy} onClick={() => { if (window.confirm('Disconnect this number and remove its WhatsApp message history? Financial transactions will be preserved.')) void run(async () => { const result = await client!.from('whatsapp_contacts').delete().eq('id', contact.id); if (result.error) throw result.error }) }}>Disconnect</button>
      </article>)}
      <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void run(save) }}>
        <h3 className="font-semibold">Link a number</h3>
        <label>Name<input className="input mt-1" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} required autoComplete="name" /></label>
        <label>WhatsApp number<input className="input mt-1" type="tel" placeholder="+353…" value={phone} onChange={(event) => setPhone(event.target.value)} required autoComplete="tel" /></label>
        <label>Pay from<select className="select mt-1" value={account} onChange={(event) => setAccount(event.target.value)} required>{state.accounts.filter((item) => !item.archived && item.currency === state.household.currency).map((item) => <option key={item.id} value={item.id}>{item.name} ({item.currency})</option>)}</select></label>
        <label>Default expense category<select className="select mt-1" value={category} onChange={(event) => setCategory(event.target.value)} required>{state.categories.filter((item) => !item.archived && !['Income', 'Receitas'].includes(item.group)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="setting-toggle"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span>I own this number and agree to send receipt images to Anthropic for extraction. HomeCoin will record valid receipts as paid expenses.</span></label>
        <button className="nav-pill min-h-11" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create verification code'}</button>
      </form>
      <button className="nav-pill inline-flex min-h-11 items-center justify-center gap-2" type="button" disabled={busy} onClick={() => void run(async () => {})}><RefreshCw size={16} />Refresh connection & history</button>
      <div><h3 className="font-semibold">Recent receipt scans</h3>{scans.length ? <ul className="mt-2 grid gap-2">{scans.map((scan) => <li key={scan.id} className="rounded-lg border border-stone-200 p-3 text-sm"><time>{new Date(scan.created_at).toLocaleString(state.settings.locale)}</time> · {scan.status}<p className="whitespace-pre-line">{scan.reply ?? 'Processing receipt…'}</p></li>)}</ul> : <p className="text-sm text-slate-500">Your receipt scans will appear here.</p>}</div>
    </div> : null}
  </section>
}
