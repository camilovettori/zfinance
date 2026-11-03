import { checked, db, env, loadHousehold, send } from '../_shared/whatsapp.ts'
import type { Contact } from '../_shared/whatsapp.ts'

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin') ?? ''
  const allowed = env('WHATSAPP_ALLOWED_ORIGINS').split(',').map((value) => value.trim())
  const headers = { 'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' }
  const response = (body: unknown, status = 200) => Response.json(body, { status, headers })
  if (!allowed.includes(origin)) return response({}, 403)
  if (request.method === 'OPTIONS') return new Response(null, { headers })
  if (request.method !== 'POST') return response({}, 405)
  try {
    const client = db()
    const token = request.headers.get('authorization')?.replace(/^Bearer /i, '') ?? ''
    const { data, error } = await client.auth.getUser(token)
    if (error || !data.user) return response({}, 401)
    const body = await request.json()
    const contact = checked(await client.from('whatsapp_contacts').select('*').eq('id', body.contactId).eq('user_id', data.user.id).not('verified_at', 'is', null).single()) as Contact
    await loadHousehold(client, contact)
    if (!contact.last_inbound_at || Date.now() - Date.parse(contact.last_inbound_at) > 23 * 3600_000) return response({ error: 'Send help in WhatsApp first to open the reply window.' }, 409)
    // One test per minute per contact, even across concurrent requests.
    const log = await client.from('whatsapp_messages').insert({ contact_id: contact.id, household_id: contact.household_id,
      provider_message_id: `test:${contact.id}:${Math.floor(Date.now() / 60000)}`, message_type: 'test', status: 'completed', reply_sent: true })
    if (log.error?.code === '23505') return response({ error: 'Wait a minute before testing again.' }, 429)
    if (log.error) throw log.error
    await send(contact, 'HomeCoin connected. Send help for commands, or send a receipt photo to add an expense.')
    return response({ sent: true })
  } catch { return response({ error: 'Connection test failed. Check server configuration.' }, 503) }
})
