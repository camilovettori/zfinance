// Isolated PostgreSQL test. No Supabase credentials or hosted data are used.
import { PGlite } from 'npm:@electric-sql/pglite@0.3.14'

const database = new PGlite()
const assert = (value: unknown, label: string) => { if (!value) throw new Error(label) }
async function rejects(sql: string, label: string) {
  let denied = false
  try { await database.exec(sql) } catch { denied = true }
  assert(denied, label)
}
await database.exec(`
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated,service_role;
grant execute on function auth.uid() to authenticated,service_role;
create schema extensions;
-- Test-only replacement for pgcrypto, unavailable in the embedded build.
create function extensions.gen_random_bytes(n integer) returns bytea language sql as $$ select decode(substr(repeat(md5(random()::text),n),1,n*2),'hex') $$;
grant usage on schema extensions to authenticated,service_role;
grant execute on function extensions.gen_random_bytes(integer) to authenticated,service_role;
`)
const original = await Deno.readTextFile(new URL('../migrations/202608100001_homecoin_schema.sql', import.meta.url))
await database.exec(original.replace('create extension if not exists pgcrypto with schema extensions;', ''))
await database.exec(await Deno.readTextFile(new URL('../migrations/20261103211314_whatsapp_integration.sql', import.meta.url)))
const household = '10000000-0000-4000-8000-000000000001'
const user = '10000000-0000-4000-8000-000000000002'
const stranger = '10000000-0000-4000-8000-000000000003'
const account = '10000000-0000-4000-8000-000000000004'
const category = '10000000-0000-4000-8000-000000000005'
const contact = '10000000-0000-4000-8000-000000000006'
const message = '10000000-0000-4000-8000-000000000007'
const undo = '10000000-0000-4000-8000-000000000008'
await database.exec(`
insert into auth.users(id) values ('${user}'),('${stranger}');
select set_config('request.jwt.claim.sub','${user}',false);
insert into homecoin.households(id,household_id,payload,created_by,updated_by,client_updated_at)
values('${household}','${household}','{}','${user}','${user}',now());
insert into homecoin.household_members(id,household_id,user_id,role,payload,created_by,updated_by,client_updated_at)
values(gen_random_uuid(),'${household}','${user}','owner','{}','${user}','${user}',now());
insert into homecoin.financial_accounts(id,household_id,payload,created_by,updated_by,client_updated_at)
values('${account}','${household}','{}','${user}','${user}',now());
insert into homecoin.categories(id,household_id,payload,created_by,updated_by,client_updated_at)
values('${category}','${household}','{"group":"Essentials"}','${user}','${user}',now());
grant usage on schema homecoin to authenticated;
grant select on homecoin.household_members,homecoin.financial_accounts,homecoin.categories,homecoin.transactions to authenticated;
set role authenticated;
insert into homecoin.whatsapp_contacts(household_id,user_id,member_name,phone_number,account_id,category_id)
values('${household}','${user}','Camilo','353870000001','${account}','${category}');
`)
assert((await database.query('select * from homecoin.whatsapp_contacts')).rows.length === 1, 'Owner can link own contact')
await rejects("update homecoin.whatsapp_contacts set verified_at=now()", 'Browser cannot forge verification')
await rejects(`select homecoin.whatsapp_record_expense('${message}','{}','test')`, 'Authenticated client cannot invoke service expense RPC')
await database.exec(`select set_config('request.jwt.claim.sub','${stranger}',false)`)
assert((await database.query('select * from homecoin.whatsapp_contacts')).rows.length === 0, 'Other user cannot read contact or verification code')
await rejects(`insert into homecoin.whatsapp_contacts(household_id,user_id,member_name,phone_number,account_id,category_id) values('${household}','${stranger}','Intruder','353870000002','${account}','${category}')`, 'Non-member cannot link number')
await database.exec(`reset role; select set_config('request.jwt.claim.sub','',false);
update homecoin.whatsapp_contacts set id='${contact}',verified_at=now();
select set_config('request.jwt.claims','{"role":"service_role"}',false);
set role service_role;
insert into homecoin.whatsapp_messages(id,contact_id,household_id,provider_message_id,message_type) values('${message}','${contact}','${household}','provider-1','image');`)
await rejects(`insert into homecoin.whatsapp_messages(contact_id,household_id,provider_message_id,message_type) values('${contact}','${household}','provider-1','image')`, 'Duplicate provider message rejected')
assert((await database.query(`select homecoin.whatsapp_claim('${message}') as claimed`)).rows[0].claimed, 'First worker claims receipt')
assert(!(await database.query(`select homecoin.whatsapp_claim('${message}') as claimed`)).rows[0].claimed, 'Second worker cannot claim receipt lease')
const tx = { householdId: household, accountId: account, categoryId: category, source: 'whatsapp', type: 'expense', status: 'paid', amountCents: 4750, title: 'Penneys', transactionDate: '2026-11-03' }
const first = await database.query(`select homecoin.whatsapp_record_expense($1,$2::jsonb,'Added') as id`, [message, JSON.stringify(tx)])
const second = await database.query(`select homecoin.whatsapp_record_expense($1,$2::jsonb,'Added') as id`, [message, JSON.stringify(tx)])
assert(first.rows[0].id === second.rows[0].id, 'Receipt retry returns same transaction')
assert((await database.query('select * from homecoin.transactions')).rows.length === 1, 'Receipt inserted exactly once')
const metadata = (await database.query('select created_by,version,payload from homecoin.transactions')).rows[0]
assert(metadata.created_by === user && metadata.version === 1, 'Service attribution and sync version correct')
await database.exec(`insert into homecoin.whatsapp_messages(id,contact_id,household_id,provider_message_id,message_type) values('${undo}','${contact}','${household}','provider-undo','text')`)
await database.query(`select homecoin.whatsapp_undo('${undo}','Cancelled')`)
await database.query(`select homecoin.whatsapp_undo('${undo}','Cancelled')`)
const cancelled = (await database.query('select payload,version from homecoin.transactions')).rows[0]
assert(cancelled.payload.status === 'cancelled' && cancelled.version === 2, 'UNDO preserves transaction and increments version exactly once')
await database.exec(`reset role; select set_config('request.jwt.claim.sub','${user}',false); update homecoin.household_members set deleted_at=now(); select set_config('request.jwt.claim.sub','',false);`)
const revokedMessage = '10000000-0000-4000-8000-000000000009'
await database.exec(`set role service_role; insert into homecoin.whatsapp_messages(id,contact_id,household_id,provider_message_id,message_type) values('${revokedMessage}','${contact}','${household}','revoked','image')`)
let revoked = false
try { await database.query('select homecoin.whatsapp_record_expense($1,$2::jsonb,$3)', [revokedMessage, JSON.stringify(tx), 'Added']) } catch { revoked = true }
assert(revoked, 'Revoked member cannot create WhatsApp expense')
await database.close()
console.log('WhatsApp PostgreSQL integration passed: RLS, ownership, signature-independent inbox deduplication, leases, atomic expense retry, undo and revoked membership.')
