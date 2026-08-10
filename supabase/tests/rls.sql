begin;
create extension if not exists pgtap;
select plan(19);

create or replace function public.set_test_claims(p_sub uuid, p_email text)
returns void language plpgsql stable
set search_path = '' as $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_sub::text, 'email', p_email, 'role', 'authenticated')::text,
    true
  );
end $$;

insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'owner@example.test', crypt('password-123', gen_salt('bf')), now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'member@example.test', crypt('password-123', gen_salt('bf')), now(), '{}', '{}', now(), now());

set local role authenticated;
select public.set_test_claims('11111111-1111-1111-1111-111111111111', 'owner@example.test');

select homecoin.create_household(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Household A',
  '{"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","name":"Household A","currency":"EUR","locale":"en-IE","financialMonthStartDay":1,"weekStartDay":1,"createdAt":"2026-08-06T12:00:00.000Z"}',
  'Owner', null
);
select homecoin.create_household(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'Household B',
  '{"id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","name":"Household B","currency":"EUR","locale":"en-IE","financialMonthStartDay":1,"weekStartDay":1,"createdAt":"2026-08-06T12:00:00.000Z"}',
  'Owner', null
);
select homecoin.create_household(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'Household C',
  '{"id":"cccccccc-cccc-cccc-cccc-cccccccccccc","name":"Household C","currency":"EUR","locale":"en-IE","financialMonthStartDay":1,"weekStartDay":1,"createdAt":"2026-08-06T12:00:00.000Z"}',
  'Owner', null
);

select ok(homecoin.is_household_owner('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'owner can read their own household');

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","email":"member@example.test","role":"authenticated"}', true);

select is((select count(*) from homecoin.households where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0::bigint, 'member cannot read household A before invite');
select is((select count(*) from homecoin.recurring_rules where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0::bigint, 'member cannot read recurring rules of household A before invite');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","email":"owner@example.test","role":"authenticated"}', true);

select throws_ok(
  $$select homecoin.create_household_invite('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'member@example.test', 'member', 'expired-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', now() - interval '1 minute')$$,
  null, null, 'expired invite creation is rejected'
);

select homecoin.create_household_invite('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'member@example.test', 'member', 'invite-token-a-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', now() + interval '1 day');
select homecoin.create_household_invite('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'member@example.test', 'member', 'invite-token-b-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', now() + interval '1 day');
select homecoin.create_household_invite('cccccccc-cccc-cccc-cccc-cccccccccccc', 'member@example.test', 'member', 'invite-token-c-cccccccccccccccccccccccccccccccc', now() + interval '1 day');

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","email":"member@example.test","role":"authenticated"}', true);

select throws_ok(
  $$select homecoin.accept_household_invite('invite-token-b-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')$$,
  null, null, 'invite issued to a different email is rejected'
);

select homecoin.accept_household_invite('invite-token-a-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select throws_ok(
  $$select homecoin.accept_household_invite('invite-token-a-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  null, null, 'used invite cannot be reused'
);

select throws_ok(
  $$select homecoin.create_household_invite('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner@example.test', 'member', 'member-cannot-invite-token-cccccccccccccccccccccccccccc', now() + interval '1 day')$$,
  null, null, 'non-owner cannot create invites'
);
select throws_ok(
  $$select homecoin.remove_household_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', (select id from homecoin.household_members where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and role = 'owner' and deleted_at is null))$$,
  null, null, 'non-owner cannot remove members'
);

select homecoin.accept_household_invite('invite-token-b-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select homecoin.accept_household_invite('invite-token-c-cccccccccccccccccccccccccccccccc');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","email":"owner@example.test","role":"authenticated"}', true);

insert into homecoin.transactions(id, household_id, payload, created_by, updated_by, client_updated_at)
values (
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '{"id":"dddddddd-dddd-dddd-dddd-dddddddddddd","householdId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","title":"RLS transaction","amountCents":12345,"transactionDate":"2026-08-06","kind":"expense","status":"pending"}',
  '22222222-2222-2222-2222-222222222222',
  '22222222-2222-2222-2222-222222222222',
  now()
);
select is(
  (select created_by from homecoin.transactions where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  '11111111-1111-1111-1111-111111111111',
  'created_by cannot be forged'
);
select is(
  (select updated_by from homecoin.transactions where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  '11111111-1111-1111-1111-111111111111',
  'updated_by cannot be forged'
);

insert into homecoin.recurring_rules(id, household_id, payload, created_by, updated_by, client_updated_at)
values (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '{"id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","householdId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","name":"RLS recurring","amountCents":4200,"nextDueDate":"2026-08-20"}',
  auth.uid(),
  auth.uid(),
  now()
);

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","email":"member@example.test","role":"authenticated"}', true);

select is(
  (select count(*) from homecoin.transactions where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  1::bigint,
  'member can read permitted transaction'
);

update homecoin.transactions
set payload = '{"id":"dddddddd-dddd-dddd-dddd-dddddddddddd","householdId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","title":"RLS transaction updated","amountCents":12345,"transactionDate":"2026-08-06","kind":"expense","status":"pending"}'::jsonb,
    updated_by = '11111111-1111-1111-1111-111111111111',
    client_updated_at = now()
where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
  and household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and version = 1;

select is(
  (select version from homecoin.transactions where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  2,
  'member update increments version'
);
select is(
  (select updated_by from homecoin.transactions where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  '22222222-2222-2222-2222-222222222222',
  'updated_by is normalized on member update'
);

insert into homecoin.transactions(id, household_id, payload, client_updated_at)
values (
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '{"id":"ffffffff-ffff-ffff-ffff-ffffffffffff","householdId":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","title":"Isolated transaction","amountCents":3210,"transactionDate":"2026-08-07","kind":"income","status":"completed"}',
  now()
);
select is(
  ((select count(*) from homecoin.transactions where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text || ':' || (select count(*) from homecoin.transactions where household_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')::text),
  '1:1',
  'household isolation remains separate for the same owner'
);

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","email":"member@example.test","role":"authenticated"}', true);

select homecoin.leave_household('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is(
  (select count(*) from homecoin.transactions where household_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0::bigint,
  'member who leaves loses access'
);

select is(
  (
    with attempt as (
      update homecoin.transactions
      set deleted_at = now(), client_updated_at = now()
      where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
        and household_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
        and version = 1
      returning 1
    )
    select count(*) from attempt
  ),
  0::bigint,
  'soft delete remains subject to RLS'
);

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","email":"owner@example.test","role":"authenticated"}', true);

select homecoin.remove_household_member(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select id from homecoin.household_members where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and user_id = '22222222-2222-2222-2222-222222222222' and deleted_at is null)
);

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","email":"member@example.test","role":"authenticated"}', true);

select is(
  (select count(*) from homecoin.transactions where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'removed member loses access'
);

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","email":"owner@example.test","role":"authenticated"}', true);

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","email":"member@example.test","role":"authenticated"}', true);

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","email":"owner@example.test","role":"authenticated"}', true);

select homecoin.leave_household('cccccccc-cccc-cccc-cccc-cccccccccccc');
select is(
  (select role from homecoin.household_members where household_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' and user_id = '22222222-2222-2222-2222-222222222222' and deleted_at is null),
  'owner',
  'successor promotion keeps the household valid'
);

update homecoin.transactions
set deleted_at = now(), client_updated_at = now()
where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
  and household_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  and version = 1;

select is(
  (select count(*) from homecoin.transactions where household_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and deleted_at is not null),
  0::bigint,
  'soft delete remains subject to RLS'
);

select is(
  (select count(*) from homecoin.transactions where household_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0::bigint,
  'tombstones are hidden from the external household'
);

select * from finish();
rollback;
