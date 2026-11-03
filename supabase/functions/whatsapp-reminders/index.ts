import { localClock } from '../../../src/domain/whatsapp.ts'
import { checked, db, env, json, loadHousehold, processMessage, send, summary } from '../_shared/whatsapp.ts'
import type { Contact, Inbound } from '../_shared/whatsapp.ts'

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (request.headers.get('authorization') !== `Bearer ${env('WHATSAPP_CRON_SECRET')}`) return json({}, 401)
  const client = db(); let jobs = 0; let reminders = 0; let failures = 0
  try {
    const pending = checked(await client.from('whatsapp_messages').select('*').or('and(status.neq.completed,attempts.lt.5),and(status.eq.completed,reply_sent.eq.false,reply_attempts.lt.5)').order('created_at').limit(2)) as Inbound[]
    for (const message of pending) {
      const contact = checked(await client.from('whatsapp_contacts').select('*').eq('id', message.contact_id).not('verified_at', 'is', null).maybeSingle()) as Contact | null
      if (!contact) continue
      try { await processMessage(client, message, contact); jobs++ } catch {
        failures++
        if (message.attempts >= 4) checked(await client.from('whatsapp_messages').update({ status: 'completed', payload: {}, reply: 'Could not process your message. No new expense was added. Please check the planner and try a clearer photo.', lease_until: null }).eq('id', message.id).neq('status', 'completed'))
      }
    }
    const contacts = checked(await client.from('whatsapp_contacts').select('*').eq('notifications_enabled', true).not('verified_at', 'is', null)) as Contact[]
    for (const contact of contacts) {
      const clock = localClock(new Date(), contact.timezone)
      // Run every minute in UTC, match Dublin wall time (including summer time).
      const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
      const elapsed = minutes(clock.time) - minutes(contact.reminder_time)
      if (elapsed < 0 || elapsed >= 10) continue
      try {
        const seed = await client.from('whatsapp_reminder_deliveries').insert({ contact_id: contact.id, local_date: clock.date })
        if (seed.error && seed.error.code !== '23505') throw seed.error
        const claimed = checked(await client.from('whatsapp_reminder_deliveries').update({ status: 'processing', lease_until: new Date(Date.now() + 5 * 60_000).toISOString() })
          .eq('contact_id', contact.id).eq('local_date', clock.date).neq('status', 'sent')
          .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`).select('contact_id'))
        if (!claimed?.length) continue
        const state = await loadHousehold(client, contact)
        const message = summary(state, 'tomorrow', contact.timezone)
        await send(contact, message, true)
        checked(await client.from('whatsapp_reminder_deliveries').update({ status: 'sent' }).eq('contact_id', contact.id).eq('local_date', clock.date))
        reminders++
      } catch { failures++ }
    }
    return json({ jobs, reminders, failures })
  } catch { return json({ error: 'WhatsApp worker unavailable' }, 503) }
})
