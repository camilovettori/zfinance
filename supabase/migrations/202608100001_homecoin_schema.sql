-- HomeCoin shared-household schema migration for the dedicated homecoin schema.
create schema if not exists homecoin;
create extension if not exists pgcrypto with schema extensions;

create type homecoin.household_role as enum ('owner', 'member');

create table homecoin.households (
  id uuid primary key,
  household_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  version integer not null default 1 check (version > 0),
  deleted_at timestamptz,
  client_updated_at timestamptz not null,
  device_id uuid,
  constraint households_self_id check (household_id = id)
);

create table homecoin.household_members (
  id uuid primary key,
  household_id uuid not null references homecoin.households(id),
  user_id uuid not null references auth.users(id),
  role homecoin.household_role not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
  version integer not null default 1 check (version > 0), deleted_at timestamptz,
  client_updated_at timestamptz not null, device_id uuid
);
create unique index household_members_active_user_idx on homecoin.household_members(household_id, user_id) where deleted_at is null;

do $$
declare entity_table text;
begin
  foreach entity_table in array array['financial_accounts', 'categories', 'transactions', 'recurring_rules', 'settings'] loop
    execute format($sql$
      create table homecoin.%I (
        id uuid primary key,
        household_id uuid not null references homecoin.households(id),
        payload jsonb not null check (jsonb_typeof(payload) = 'object'),
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
        version integer not null default 1 check (version > 0), deleted_at timestamptz,
        client_updated_at timestamptz not null, device_id uuid
      )
    $sql$, entity_table);
    execute format('create index %I on homecoin.%I(household_id, updated_at)', entity_table || '_household_updated_idx', entity_table);
  end loop;
end $$;

create table homecoin.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references homecoin.households(id),
  email text not null check (email = lower(email)),
  role homecoin.household_role not null default 'member' check (role = 'member'),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  constraint invite_expiry_after_creation check (expires_at > created_at)
);
create index household_invites_lookup_idx on homecoin.household_invites(token_hash) where used_at is null;
create index household_invites_rate_idx on homecoin.household_invites(created_by, created_at desc);

create table homecoin.sync_audit_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references homecoin.households(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);

create or replace function homecoin.is_household_member(target_household uuid)
returns boolean language sql stable security definer
set search_path = '' set row_security = off
as $$
  select exists (
    select 1 from homecoin.household_members m
    where m.household_id = target_household and m.user_id = auth.uid() and m.deleted_at is null
  );
$$;

create or replace function homecoin.is_household_owner(target_household uuid)
returns boolean language sql stable security definer
set search_path = '' set row_security = off
as $$
  select exists (
    select 1 from homecoin.household_members m
    where m.household_id = target_household and m.user_id = auth.uid() and m.role = 'owner' and m.deleted_at is null
  );
$$;

revoke all on function homecoin.is_household_member(uuid) from public;
revoke all on function homecoin.is_household_owner(uuid) from public;
grant execute on function homecoin.is_household_member(uuid), homecoin.is_household_owner(uuid) to authenticated;

create or replace function homecoin.set_sync_insert_metadata()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  new.created_by := auth.uid(); new.updated_by := auth.uid();
  new.created_at := now(); new.updated_at := now(); new.version := 1;
  new.client_updated_at := coalesce(new.client_updated_at, now());
  return new;
end $$;

create or replace function homecoin.touch_sync_row()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  new.created_by := old.created_by; new.created_at := old.created_at;
  new.updated_by := auth.uid(); new.updated_at := now(); new.version := old.version + 1;
  new.household_id := old.household_id;
  return new;
end $$;

do $$
declare entity_table text;
begin
  foreach entity_table in array array['households', 'household_members', 'financial_accounts', 'categories', 'transactions', 'recurring_rules', 'settings'] loop
    execute format('create trigger set_%I_insert before insert on homecoin.%I for each row execute function homecoin.set_sync_insert_metadata()', entity_table, entity_table);
    execute format('create trigger touch_%I_update before update on homecoin.%I for each row execute function homecoin.touch_sync_row()', entity_table, entity_table);
    execute format('alter table homecoin.%I enable row level security', entity_table);
  end loop;
  alter table homecoin.household_invites enable row level security;
  alter table homecoin.sync_audit_events enable row level security;
end $$;

create policy households_read on homecoin.households for select to authenticated
  using (homecoin.is_household_member(id));
create policy households_update on homecoin.households for update to authenticated
  using (homecoin.is_household_member(id)) with check (homecoin.is_household_member(id) and household_id = id);

create policy household_members_read on homecoin.household_members for select to authenticated
  using (homecoin.is_household_member(household_id));

do $$
declare entity_table text;
begin
  foreach entity_table in array array['financial_accounts', 'categories', 'transactions', 'recurring_rules', 'settings'] loop
    execute format('create policy %I_read on homecoin.%I for select to authenticated using (homecoin.is_household_member(household_id))', entity_table, entity_table);
    execute format('create policy %I_insert on homecoin.%I for insert to authenticated with check (homecoin.is_household_member(household_id) and created_by = auth.uid() and updated_by = auth.uid())', entity_table, entity_table);
    execute format('create policy %I_update on homecoin.%I for update to authenticated using (homecoin.is_household_member(household_id)) with check (homecoin.is_household_member(household_id) and updated_by = auth.uid())', entity_table, entity_table);
  end loop;
end $$;

create policy invites_owner_read on homecoin.household_invites for select to authenticated
  using (homecoin.is_household_owner(household_id));
create policy audit_member_read on homecoin.sync_audit_events for select to authenticated
  using (homecoin.is_household_member(household_id));
create policy audit_member_insert on homecoin.sync_audit_events for insert to authenticated
  with check (homecoin.is_household_member(household_id) and created_by = auth.uid());

-- No DELETE policy exists. All entity and membership removal is a versioned soft delete.

create or replace function homecoin.create_household(
  p_id uuid, p_name text, p_payload jsonb, p_owner_name text, p_device_id uuid default null
) returns jsonb language plpgsql security definer
set search_path = '' set row_security = off as $$
declare h homecoin.households; m homecoin.household_members; now_at timestamptz := now(); member_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(trim(p_name)) not between 1 and 120 then raise exception 'Household name must contain 1 to 120 characters'; end if;
  insert into homecoin.households(id, household_id, payload, created_by, updated_by, client_updated_at, device_id)
  values (p_id, p_id, p_payload, auth.uid(), auth.uid(), now_at, p_device_id) returning * into h;
  insert into homecoin.household_members(id, household_id, user_id, role, payload, created_by, updated_by, client_updated_at, device_id)
  values (
    member_id, p_id, auth.uid(), 'owner',
    jsonb_build_object('id', member_id::text, 'householdId', p_id::text, 'name', left(coalesce(nullif(trim(p_owner_name), ''), 'Owner'), 120), 'role', 'owner', 'color', '#2F7D5B', 'active', true),
    auth.uid(), auth.uid(), now_at, p_device_id
  ) returning * into m;
  insert into homecoin.sync_audit_events(household_id, entity_type, entity_id, action, created_by)
  values (p_id, 'households', p_id, 'created', auth.uid());
  return jsonb_build_object('household', h.payload, 'membership', m.payload);
end $$;

create or replace function homecoin.list_my_households()
returns setof jsonb language sql stable security definer
set search_path = '' set row_security = off as $$
  select jsonb_build_object('household', h.payload, 'membership', m.payload)
  from homecoin.household_members m join homecoin.households h on h.id = m.household_id
  where m.user_id = auth.uid() and m.deleted_at is null and h.deleted_at is null
  order by h.created_at;
$$;

create or replace function homecoin.create_household_invite(
  p_household_id uuid, p_email text, p_role homecoin.household_role, p_token text, p_expires_at timestamptz
) returns jsonb language plpgsql security definer
set search_path = '' set row_security = off as $$
declare invitation homecoin.household_invites;
begin
  if not homecoin.is_household_owner(p_household_id) then raise exception 'Only the household owner can create invitations'; end if;
  if p_role <> 'member' then raise exception 'Only the member role can be invited'; end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '7 days' then raise exception 'Invitation expiry must be within seven days'; end if;
  if length(p_token) < 32 then raise exception 'Invitation token is too short'; end if;
  if (select count(*) from homecoin.household_invites where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Invitation rate limit reached';
  end if;
  insert into homecoin.household_invites(household_id, email, role, token_hash, expires_at, created_by)
  values (p_household_id, lower(trim(p_email)), p_role, encode(extensions.digest(p_token, 'sha256'), 'hex'), p_expires_at, auth.uid())
  returning * into invitation;
  insert into homecoin.sync_audit_events(household_id, entity_type, entity_id, action, metadata, created_by)
  values (p_household_id, 'household_invites', invitation.id, 'created', jsonb_build_object('expires_at', p_expires_at), auth.uid());
  return jsonb_build_object('id', invitation.id, 'expires_at', invitation.expires_at);
end $$;

create or replace function homecoin.accept_household_invite(p_token text)
returns jsonb language plpgsql security definer
set search_path = '' set row_security = off as $$
declare invitation homecoin.household_invites; h homecoin.households; m homecoin.household_members; user_email text; member_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  user_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  select * into invitation from homecoin.household_invites
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and used_at is null and expires_at > now()
  for update;
  if not found then raise exception 'Invitation is invalid, expired, or already used'; end if;
  if invitation.email <> user_email then raise exception 'Invitation was issued to a different email address'; end if;
  select * into h from homecoin.households where id = invitation.household_id and deleted_at is null;
  if not found then raise exception 'Household is unavailable'; end if;
  insert into homecoin.household_members(id, household_id, user_id, role, payload, created_by, updated_by, client_updated_at)
  values (
    member_id, h.id, auth.uid(), invitation.role,
    jsonb_build_object('id', member_id::text, 'householdId', h.id::text, 'name', user_email, 'role', invitation.role::text, 'color', '#4A6FA5', 'active', true),
    auth.uid(), auth.uid(), now()
  ) returning * into m;
  update homecoin.household_invites set used_at = now(), used_by = auth.uid() where id = invitation.id;
  insert into homecoin.sync_audit_events(household_id, entity_type, entity_id, action, created_by)
  values (h.id, 'household_members', m.id, 'invite_accepted', auth.uid());
  return jsonb_build_object('household', h.payload, 'membership', m.payload);
end $$;

create or replace function homecoin.remove_household_member(p_household_id uuid, p_membership_id uuid)
returns void language plpgsql security definer
set search_path = '' set row_security = off as $$
declare target homecoin.household_members;
begin
  if not homecoin.is_household_owner(p_household_id) then raise exception 'Only the owner can remove a member'; end if;
  select * into target from homecoin.household_members where id = p_membership_id and household_id = p_household_id and deleted_at is null for update;
  if not found then raise exception 'Member not found'; end if;
  if target.role = 'owner' then raise exception 'The owner cannot be removed'; end if;
  update homecoin.household_members set deleted_at = now(), client_updated_at = now() where id = target.id;
  insert into homecoin.sync_audit_events(household_id, entity_type, entity_id, action, created_by)
  values (p_household_id, 'household_members', target.id, 'removed', auth.uid());
end $$;

create or replace function homecoin.leave_household(p_household_id uuid)
returns void language plpgsql security definer
set search_path = '' set row_security = off as $$
declare mine homecoin.household_members; successor homecoin.household_members;
begin
  select * into mine from homecoin.household_members where household_id = p_household_id and user_id = auth.uid() and deleted_at is null for update;
  if not found then raise exception 'You are not an active household member'; end if;
  if mine.role = 'owner' then
    select * into successor from homecoin.household_members
    where household_id = p_household_id and id <> mine.id and deleted_at is null order by created_at limit 1 for update;
    if found then
      update homecoin.household_members set role = 'owner', payload = jsonb_set(payload, '{role}', '"owner"'::jsonb), client_updated_at = now() where id = successor.id;
    else
      update homecoin.households set deleted_at = now(), client_updated_at = now() where id = p_household_id;
    end if;
  end if;
  update homecoin.household_members set deleted_at = now(), client_updated_at = now() where id = mine.id;
  insert into homecoin.sync_audit_events(household_id, entity_type, entity_id, action, created_by)
  values (p_household_id, 'household_members', mine.id, 'left', auth.uid());
end $$;

revoke all on function homecoin.create_household(uuid, text, jsonb, text, uuid) from public;
revoke all on function homecoin.list_my_households() from public;
revoke all on function homecoin.create_household_invite(uuid, text, homecoin.household_role, text, timestamptz) from public;
revoke all on function homecoin.accept_household_invite(text) from public;
revoke all on function homecoin.remove_household_member(uuid, uuid) from public;
revoke all on function homecoin.leave_household(uuid) from public;
grant execute on function homecoin.create_household(uuid, text, jsonb, text, uuid), homecoin.list_my_households(),
  homecoin.create_household_invite(uuid, text, homecoin.household_role, text, timestamptz), homecoin.accept_household_invite(text),
  homecoin.remove_household_member(uuid, uuid), homecoin.leave_household(uuid) to authenticated;

do $$
declare entity_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach entity_table in array array['households', 'household_members', 'financial_accounts', 'categories', 'transactions', 'recurring_rules', 'settings'] loop
      if not exists (
        select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'homecoin' and tablename = entity_table
      ) then execute format('alter publication supabase_realtime add table homecoin.%I', entity_table); end if;
    end loop;
  end if;
end $$;
