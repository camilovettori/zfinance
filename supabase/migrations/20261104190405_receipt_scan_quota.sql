create table homecoin.receipt_scan_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  hour_bucket timestamptz not null,
  scans integer not null default 1,
  primary key(user_id,hour_bucket)
);
alter table homecoin.receipt_scan_usage enable row level security;
revoke all on homecoin.receipt_scan_usage from public,anon,authenticated;
-- A narrowly scoped authenticated RPC updates only the caller's hourly counter.
create function homecoin.claim_receipt_scan(p_household uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare count_used integer;
begin
  if auth.uid() is null or not homecoin.is_household_member(p_household) then raise exception 'Access denied'; end if;
  insert into homecoin.receipt_scan_usage(user_id,hour_bucket) values(auth.uid(),date_trunc('hour',now()))
  on conflict(user_id,hour_bucket) do update set scans=homecoin.receipt_scan_usage.scans+1
  returning scans into count_used;
  if count_used > 20 then raise exception 'Hourly receipt scan limit reached'; end if;
end $$;
revoke all on function homecoin.claim_receipt_scan(uuid) from public,anon;
grant execute on function homecoin.claim_receipt_scan(uuid) to authenticated;
