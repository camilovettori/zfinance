-- Opt-in only. No contacts, schedules or outbound messages are created here.
grant usage on schema homecoin to service_role;
grant select on homecoin.households, homecoin.household_members, homecoin.financial_accounts, homecoin.categories, homecoin.transactions, homecoin.recurring_rules, homecoin.settings to service_role;
grant insert, update on homecoin.transactions to service_role;
create table homecoin.whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references homecoin.households(id),
  user_id uuid not null default auth.uid() references auth.users(id),
  member_name text not null check (length(member_name) between 1 and 120),
  phone_number text not null unique check (phone_number ~ '^[1-9][0-9]{7,14}$'),
  account_id uuid not null references homecoin.financial_accounts(id),
  category_id uuid not null references homecoin.categories(id),
  notifications_enabled boolean not null default false,
  reminder_time time not null default '20:00',
  timezone text not null default 'Europe/Dublin' check (timezone = 'Europe/Dublin'),
  link_code text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  link_expires_at timestamptz not null default now() + interval '15 minutes',
  verified_at timestamptz,
  last_inbound_at timestamptz,
  created_at timestamptz not null default now()
);
create index whatsapp_contacts_household_idx on homecoin.whatsapp_contacts(household_id);
alter table homecoin.whatsapp_contacts enable row level security;
create policy whatsapp_contacts_read on homecoin.whatsapp_contacts for select to authenticated
  using (homecoin.is_household_member(household_id) and user_id = auth.uid());
create policy whatsapp_contacts_insert on homecoin.whatsapp_contacts for insert to authenticated
  with check (homecoin.is_household_member(household_id) and user_id = auth.uid() and verified_at is null
    and not notifications_enabled
    and exists (select 1 from homecoin.financial_accounts a where a.id = account_id and a.household_id = whatsapp_contacts.household_id and a.deleted_at is null)
    and exists (select 1 from homecoin.categories c where c.id = category_id and c.household_id = whatsapp_contacts.household_id and c.deleted_at is null and c.payload->>'group' not in ('Income', 'Receitas')));
create policy whatsapp_contacts_update on homecoin.whatsapp_contacts for update to authenticated
  using (user_id = auth.uid() and homecoin.is_household_member(household_id))
  with check (user_id = auth.uid() and homecoin.is_household_member(household_id));
create policy whatsapp_contacts_delete on homecoin.whatsapp_contacts for delete to authenticated
  using (user_id = auth.uid() and homecoin.is_household_member(household_id));
-- Browser clients may only change reminder preferences. Verification is server-owned.
revoke all on homecoin.whatsapp_contacts from public, anon, authenticated;
grant select, delete on homecoin.whatsapp_contacts to authenticated;
grant insert (household_id, user_id, member_name, phone_number, account_id, category_id) on homecoin.whatsapp_contacts to authenticated;
grant update (notifications_enabled, reminder_time) on homecoin.whatsapp_contacts to authenticated;
grant all on homecoin.whatsapp_contacts to service_role;

create table homecoin.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references homecoin.whatsapp_contacts(id) on delete cascade,
  household_id uuid not null references homecoin.households(id),
  provider_message_id text not null unique,
  message_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  attempts integer not null default 0,
  lease_until timestamptz,
  reply text,
  reply_sent boolean not null default false,
  reply_attempts integer not null default 0,
  transaction_id uuid references homecoin.transactions(id),
  parsed_data jsonb,
  created_at timestamptz not null default now()
);
create index whatsapp_messages_queue_idx on homecoin.whatsapp_messages(status, lease_until);
create index whatsapp_messages_contact_idx on homecoin.whatsapp_messages(contact_id, created_at desc);
alter table homecoin.whatsapp_messages enable row level security;
create policy whatsapp_messages_read on homecoin.whatsapp_messages for select to authenticated
  using (homecoin.is_household_member(household_id) and exists (
    select 1 from homecoin.whatsapp_contacts c where c.id = contact_id and c.user_id = auth.uid()));
revoke all on homecoin.whatsapp_messages from public, anon, authenticated;
grant select on homecoin.whatsapp_messages to authenticated;
grant all on homecoin.whatsapp_messages to service_role;

create table homecoin.whatsapp_reminder_deliveries (
  contact_id uuid not null references homecoin.whatsapp_contacts(id) on delete cascade,
  local_date date not null,
  status text not null default 'pending',
  lease_until timestamptz,
  primary key(contact_id, local_date)
);
alter table homecoin.whatsapp_reminder_deliveries enable row level security;
revoke all on homecoin.whatsapp_reminder_deliveries from public, anon, authenticated;
grant all on homecoin.whatsapp_reminder_deliveries to service_role;

-- Dedicated transaction triggers allow the service to attribute WhatsApp writes
-- to a verified, still-active household member. Other sync tables stay unchanged.
create function homecoin.whatsapp_transaction_metadata() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
    if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  elsif coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role'
    and new.payload->>'source' = 'whatsapp'
    and exists (select 1 from homecoin.whatsapp_contacts c join homecoin.household_members m
      on m.household_id = c.household_id and m.user_id = c.user_id and m.deleted_at is null
      where c.household_id = new.household_id and c.user_id = new.updated_by and c.verified_at is not null) then
    if tg_op = 'UPDATE' and (old.payload->>'source' is distinct from 'whatsapp' or old.created_by <> new.updated_by) then
      raise exception 'Invalid WhatsApp transaction';
    end if;
  else raise exception 'Authentication required'; end if;
  if tg_op = 'INSERT' then
    new.created_at := now(); new.version := 1;
  else
    new.created_by := old.created_by; new.created_at := old.created_at;
    new.household_id := old.household_id; new.version := old.version + 1;
  end if;
  new.updated_at := now(); new.client_updated_at := now(); return new;
end $$;
drop trigger set_transactions_insert on homecoin.transactions;
drop trigger touch_transactions_update on homecoin.transactions;
create trigger set_transactions_insert before insert on homecoin.transactions for each row execute function homecoin.whatsapp_transaction_metadata();
create trigger touch_transactions_update before update on homecoin.transactions for each row execute function homecoin.whatsapp_transaction_metadata();

create function homecoin.whatsapp_claim(p_id uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  update homecoin.whatsapp_messages set status = 'processing', attempts = attempts + 1, lease_until = now() + interval '5 minutes'
  where id = p_id and status <> 'completed' and attempts < 5 and (lease_until is null or lease_until < now());
  return found;
end $$;

-- Commit the expense and mark its source message atomically. A webhook retry
-- can never insert the same receipt twice, even after an Edge Function restart.
create function homecoin.whatsapp_record_expense(p_message uuid, p_data jsonb, p_reply text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare msg homecoin.whatsapp_messages; contact homecoin.whatsapp_contacts; tx uuid := gen_random_uuid();
begin
  select * into strict msg from homecoin.whatsapp_messages where id = p_message for update;
  if msg.transaction_id is not null then return msg.transaction_id; end if;
  select * into strict contact from homecoin.whatsapp_contacts where id = msg.contact_id and verified_at is not null;
  if p_data->>'accountId' <> contact.account_id::text or p_data->>'householdId' <> contact.household_id::text
    or p_data->>'source' <> 'whatsapp' or p_data->>'type' <> 'expense' or p_data->>'status' <> 'paid'
    or (p_data->>'amountCents')::bigint not between 1 and 100000000
    or not exists (select 1 from homecoin.categories where id = (p_data->>'categoryId')::uuid and household_id = contact.household_id and deleted_at is null)
    then raise exception 'Invalid expense'; end if;
  insert into homecoin.transactions(id, household_id, payload, created_by, updated_by, client_updated_at)
  values (tx, contact.household_id, p_data || jsonb_build_object('id', tx), contact.user_id, contact.user_id, now());
  update homecoin.whatsapp_messages set transaction_id = tx, parsed_data = p_data, status = 'completed', reply = p_reply, payload = '{}'::jsonb where id = p_message;
  return tx;
end $$;

create function homecoin.whatsapp_undo(p_message uuid, p_reply text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare msg homecoin.whatsapp_messages; previous homecoin.whatsapp_messages; contact homecoin.whatsapp_contacts;
begin
  select * into strict msg from homecoin.whatsapp_messages where id = p_message for update;
  if msg.status = 'completed' then return false; end if;
  select * into strict contact from homecoin.whatsapp_contacts where id = msg.contact_id for update;
  select m.* into previous from homecoin.whatsapp_messages m join homecoin.transactions t on t.id = m.transaction_id
    where m.contact_id = msg.contact_id and t.payload->>'status' = 'paid' and t.deleted_at is null
    and t.payload->>'source' = 'whatsapp' and t.created_at > now() - interval '24 hours'
    order by m.created_at desc limit 1 for update of m;
  if previous.id is not null then
    update homecoin.transactions set payload = payload || jsonb_build_object('status','cancelled','cancelledAt',now(),'updatedAt',now()), updated_by = contact.user_id
      where id = previous.transaction_id;
  end if;
  update homecoin.whatsapp_messages set status = 'completed', payload = '{}'::jsonb,
    reply = case when previous.id is not null then p_reply else 'No recent WhatsApp expense to undo.' end where id = p_message;
  return previous.id is not null;
end $$;
revoke all on function homecoin.whatsapp_claim(uuid), homecoin.whatsapp_record_expense(uuid,jsonb,text), homecoin.whatsapp_undo(uuid,text) from public, anon, authenticated;
grant execute on function homecoin.whatsapp_claim(uuid), homecoin.whatsapp_record_expense(uuid,jsonb,text), homecoin.whatsapp_undo(uuid,text) to service_role;
