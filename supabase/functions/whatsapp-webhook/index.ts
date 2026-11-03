import { verifyMetaSignature } from '../../../src/domain/whatsapp.ts'
import { checked, db, env, json } from '../_shared/whatsapp.ts'
import type { Contact } from '../_shared/whatsapp.ts'

Deno.serve(async (request: Request) => {
  try {
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams
      return params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === env('WHATSAPP_VERIFY_TOKEN')
        ? new Response(params.get('hub.challenge') ?? '') : new Response('Forbidden', { status: 403 })
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
    if (Number(request.headers.get('content-length')) > 1_000_000) return json({}, 413)
    const raw = await request.text()
    if (raw.length > 1_000_000) return json({}, 413)
    if (!await verifyMetaSignature(raw, request.headers.get('x-hub-signature-256'), env('WHATSAPP_APP_SECRET'))) return json({}, 401)
    const event = JSON.parse(raw)
    if (event.object !== 'whatsapp_business_account') return json({ received: true })
    const client = db()
    for (const entry of event.entry ?? []) for (const change of entry.changes ?? []) {
      if (change.value?.metadata?.phone_number_id !== env('WHATSAPP_PHONE_NUMBER_ID')) continue
      for (const incoming of change.value.messages ?? []) {
        if (typeof incoming.id !== 'string' || !/^[1-9]\d{7,14}$/.test(incoming.from)) continue
        let contact = checked(await client.from('whatsapp_contacts').select('*').eq('phone_number', incoming.from).maybeSingle()) as Contact | null
        if (!contact) continue
        const body = incoming.text?.body ?? ''
        const link = /^link ([a-f0-9]{32})$/i.exec(body.trim())
        if (!contact.verified_at) {
          if (!link) continue
          const linked = checked(await client.from('whatsapp_contacts').update({ verified_at: new Date().toISOString(), link_code: crypto.randomUUID().replaceAll('-', '') })
            .eq('id', contact.id).eq('link_code', link[1].toLowerCase()).gt('link_expires_at', new Date().toISOString()).select('*').maybeSingle())
          if (!linked) continue
          contact = linked as Contact
        }
        // Use provider timestamp so delayed deliveries do not extend the 24h window.
        const timestamp = Number(incoming.timestamp) * 1000
        if (!Number.isFinite(timestamp) || timestamp > Date.now() + 60_000 || timestamp < Date.now() - 24 * 3600_000) continue
        checked(await client.from('whatsapp_contacts').update({ last_inbound_at: new Date(timestamp).toISOString() }).eq('id', contact.id))
        contact.last_inbound_at = new Date(timestamp).toISOString()
        const membership = checked(await client.from('household_members').select('id').eq('household_id', contact.household_id).eq('user_id', contact.user_id).is('deleted_at', null))
        if (!membership?.length) continue
        const recent = await client.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('contact_id', contact.id).gte('created_at', new Date(Date.now() - 3600_000).toISOString())
        if (recent.error) throw recent.error
        if ((recent.count ?? 0) >= 30) continue
        const stored = await client.from('whatsapp_messages').insert({ contact_id: contact.id, household_id: contact.household_id, provider_message_id: incoming.id,
          message_type: incoming.type, payload: incoming.type === 'image' ? { image: { id: incoming.image?.id } } : { text: { body: body.slice(0, 1000) } } })
        if (stored.error && stored.error.code !== '23505') throw stored.error
        // Acknowledge once durably queued. The scheduled worker processes it;
        // slow vision requests must not keep Meta's webhook connection open.
      }
    }
    return json({ received: true })
  } catch { return json({ error: 'Webhook unavailable' }, 503) }
})
