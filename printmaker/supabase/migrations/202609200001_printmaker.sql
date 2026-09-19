-- 기존 Moonwords 테이블 및 데이터는 변경하지 않습니다.
create table if not exists public.printmaker_worksheets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) <= 100),
  payload jsonb not null check (octet_length(payload::text) <= 12000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists printmaker_worksheets_user_idx on public.printmaker_worksheets(user_id,updated_at desc);
alter table public.printmaker_worksheets enable row level security;
revoke all on public.printmaker_worksheets from anon, authenticated;
grant select,insert,update,delete on public.printmaker_worksheets to authenticated;
drop policy if exists printmaker_owner_select on public.printmaker_worksheets;
create policy printmaker_owner_select on public.printmaker_worksheets for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists printmaker_owner_insert on public.printmaker_worksheets;
create policy printmaker_owner_insert on public.printmaker_worksheets for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists printmaker_owner_update on public.printmaker_worksheets;
create policy printmaker_owner_update on public.printmaker_worksheets for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists printmaker_owner_delete on public.printmaker_worksheets;
create policy printmaker_owner_delete on public.printmaker_worksheets for delete to authenticated using ((select auth.uid())=user_id);

-- 서버에서만 갱신하는 요청 수. 날짜는 UTC, 추출은 페이지당 1회입니다.
create table if not exists public.printmaker_ai_usage (
  scope text not null, day date not null, calls integer not null default 0,
  primary key(scope,day)
);
alter table public.printmaker_ai_usage enable row level security;
revoke all on public.printmaker_ai_usage from anon, authenticated;
create or replace function public.printmaker_claim_ai(p_user uuid, p_user_limit integer, p_global_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'UTC')::date; affected integer;
begin
  if p_user is null or p_user_limit < 1 or p_global_limit < 1 then return false; end if;
  insert into public.printmaker_ai_usage(scope,day,calls) values ('global',today,1)
    on conflict(scope,day) do update set calls=public.printmaker_ai_usage.calls+1
    where public.printmaker_ai_usage.calls < p_global_limit;
  get diagnostics affected = row_count;
  if affected=0 then return false; end if;
  insert into public.printmaker_ai_usage(scope,day,calls) values (p_user::text,today,1)
    on conflict(scope,day) do update set calls=public.printmaker_ai_usage.calls+1
    where public.printmaker_ai_usage.calls < p_user_limit;
  get diagnostics affected = row_count;
  if affected=0 then
    update public.printmaker_ai_usage set calls=calls-1 where scope='global' and day=today;
    return false;
  end if;
  return true;
end;
$$;
revoke all on function public.printmaker_claim_ai(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.printmaker_claim_ai(uuid,integer,integer) to service_role;
