-- 0051 — блокировка сотрудника вместо удаления.
--
-- ЧТО БЫЛО. Убрать человека из заведения можно было только физически: политика
-- staff_delete разрешала DELETE любому с team.write. Это прямая потеря авторства —
-- в audit_log, журналах уборки, стерилизации и приёмки материалов стоит его подпись,
-- а карточка, на которую эта подпись ссылается, исчезала. Отдельного признака
-- «доступ отобран» не было вовсе: staff.is_active означает «в отпуске, записи не
-- принимает» и к правам отношения не имеет — переиспользовать его нельзя.
--
-- ЧТО ДЕЛАЕМ.
--   1. staff.blocked_at / blocked_by / blocked_reason — отдельный признак блокировки.
--   2. Удаление staff запрещено физически: политика staff_delete снята, DELETE
--      отозван у authenticated, и сверху висит триггер staff_no_delete_trg, который
--      ловит удаление даже из SECURITY DEFINER и service_role. Единственная щель —
--      флаг app.purging_account, тот самый, которым 0024 (delete_my_account) и
--      охранники журналов помечают удаление собственного аккаунта: без неё каскад
--      от tenants сломал бы удаление аккаунта владельца.
--   3. Блокировка снимает доступ. Развилка была такая:
--        а) править RLS/tenants_with — тогда каждая политика в базе начала бы ходить
--           в staff на каждой строке; это дорого и трогает десятки политик сразу;
--        б) править custom_access_token_hook — одна точка, но самое опасное место.
--      Выбран (б), но с оговоркой: сам хук изменён минимально — в трёх его выборках
--      добавлено одно и то же условие public.member_access_ok(tenant, user).
--      Вся дальнейшая логика (в 0054 — срок доступа инспектора) живёт внутри
--      member_access_ok, и хук больше переписывать не придётся.
--      ПРОВЕРЕНО ИСПОЛНЕНИЕМ: claims всех существующих пользователей сняты до
--      правки и сверены после — различий 0 из 2. Заблокированный получает
--      memberships {} и perms {}, то есть на обновлении токена теряет всё.
--   4. Уже выданный access-token живёт до истечения, база его не отзывает. Поэтому
--      block_staff дополнительно удаляет auth.sessions заблокированного — это и есть
--      «выгнать со всех устройств»: refresh перестаёт работать сразу.
--   5. Строка в tenant_members НЕ удаляется — иначе пропала бы история «кем он был».
--      ПРОВЕРЕНО: после блокировки членство на месте (1 строка), прав 0.
--
-- НЕ ТРОГАЕМ: role_grants (0034), cron.job, Vault, compliance_* и охранники
-- арендатора из 0046. is_active не трогаем — это другое понятие.

alter table public.staff
  add column blocked_at timestamptz,
  add column blocked_by uuid references auth.users(id) on delete set null,
  add column blocked_reason text;
alter table public.staff add constraint staff_blocked_shape
  check ((blocked_at is null) = (blocked_by is null));

comment on column public.staff.blocked_at is
  'Доступ отобран. НЕ путать с is_active — та про «в отпуске, записи не принимает».';

drop policy if exists staff_delete on public.staff;
revoke delete on public.staff from authenticated;

create or replace function public.staff_no_delete() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if coalesce(current_setting('app.purging_account', true), 'off') = 'on' then
    return old;
  end if;
  raise exception 'співробітника не видаляють — його підпис стоїть у незмінних журналах; використайте block_staff()';
end; $$;
revoke all on function public.staff_no_delete() from public;
create trigger staff_no_delete_trg before delete on public.staff
  for each row execute function public.staff_no_delete();

-- Единственная точка, где решается «есть ли у члена заведения доступ прямо сейчас».
-- 0054 добавит сюда срок действия. Хук после этого не трогаем.
create or replace function public.member_access_ok(p_tenant uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select not exists (
    select 1 from public.staff s
     where s.tenant_id = p_tenant and s.user_id = p_user and s.blocked_at is not null);
$$;
revoke all on function public.member_access_ok(uuid, uuid) from public;
grant execute on function public.member_access_ok(uuid, uuid) to authenticated, service_role, supabase_auth_admin;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_claims jsonb; v_memberships jsonb; v_perms jsonb; v_modules jsonb;
  v_is_staff boolean; v_uid uuid := (event->>'user_id')::uuid;
begin
  select coalesce(jsonb_object_agg(tm.tenant_id::text, tm.role::text), '{}'::jsonb)
    into v_memberships from public.tenant_members tm
   where tm.user_id = v_uid and public.member_access_ok(tm.tenant_id, tm.user_id);

  select coalesce(jsonb_object_agg(x.tenant_id::text, x.perms), '{}'::jsonb)
    into v_perms
    from (
      select tm.tenant_id,
             case when tm.role = 'owner' then '["*"]'::jsonb
                  else coalesce((
                    select jsonb_agg(p.permission) from (
                      select g.permission from public.role_grants g
                       where g.role = tm.role
                         and coalesce(tm.permissions ->> g.permission, 'true') <> 'false'
                      union
                      select o.key from jsonb_each_text(tm.permissions) as o(key, value)
                       where o.value = 'true') p), '[]'::jsonb)
             end as perms
        from public.tenant_members tm
       where tm.user_id = v_uid and public.member_access_ok(tm.tenant_id, tm.user_id)
    ) x;

  select coalesce(jsonb_object_agg(t.id::text, to_jsonb(t.modules)), '{}'::jsonb)
    into v_modules from public.tenants t
    join public.tenant_members tm on tm.tenant_id = t.id
   where tm.user_id = v_uid and public.member_access_ok(tm.tenant_id, tm.user_id);

  select coalesce(p.is_staff, false) into v_is_staff from public.profiles p where p.id = v_uid;

  v_claims := coalesce(event->'claims', '{}'::jsonb);
  if v_claims->'app_metadata' is null then
    v_claims := jsonb_set(v_claims, '{app_metadata}', '{}'::jsonb);
  end if;
  v_claims := jsonb_set(v_claims, '{app_metadata,memberships}', v_memberships);
  v_claims := jsonb_set(v_claims, '{app_metadata,perms}', v_perms);
  v_claims := jsonb_set(v_claims, '{app_metadata,modules}', v_modules);
  v_claims := jsonb_set(v_claims, '{app_metadata,is_staff}', to_jsonb(coalesce(v_is_staff, false)));
  return jsonb_set(event, '{claims}', v_claims);
end; $$;

-- Приём из 0024 (delete_my_account): «последний владелец» — единственный owner заведения.
create or replace function public.assert_not_last_owner(p_tenant uuid, p_user uuid, p_what text)
returns void language plpgsql stable security definer set search_path to '' as $$
begin
  if exists (select 1 from public.tenant_members tm
              where tm.tenant_id = p_tenant and tm.user_id = p_user and tm.role = 'owner')
     and (select count(*) from public.tenant_members tm
           where tm.tenant_id = p_tenant and tm.role = 'owner') = 1
  then
    raise exception 'це останній власник закладу — %; спершу передайте володіння (transfer_ownership)', p_what;
  end if;
end; $$;
revoke all on function public.assert_not_last_owner(uuid, uuid, text) from public;
grant execute on function public.assert_not_last_owner(uuid, uuid, text) to authenticated, service_role;

create or replace function public.block_staff(p_staff_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := auth.uid(); v_tenant uuid; v_user uuid; v_rows int;
begin
  if v_uid is null then raise exception 'не автентифіковано'; end if;
  select s.tenant_id, s.user_id into v_tenant, v_user from public.staff s where s.id = p_staff_id;
  if v_tenant is null then raise exception 'співробітника не знайдено'; end if;
  if v_tenant not in (select public.tenants_with('team.write')) then
    raise exception 'немає права team.write у цьому закладі'; end if;
  if v_user is not null then
    perform public.assert_not_last_owner(v_tenant, v_user, 'заблокувати його не можна');
  end if;
  update public.staff s set blocked_at = now(), blocked_by = v_uid, blocked_reason = p_reason
   where s.id = p_staff_id and s.blocked_at is null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'співробітник уже заблокований'; end if;
  -- выгнать со всех устройств: refresh перестаёт работать немедленно
  if v_user is not null then delete from auth.sessions ss where ss.user_id = v_user; end if;
end; $$;
revoke all on function public.block_staff(uuid, text) from public;
grant execute on function public.block_staff(uuid, text) to authenticated;

create or replace function public.unblock_staff(p_staff_id uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_rows int;
begin
  if auth.uid() is null then raise exception 'не автентифіковано'; end if;
  update public.staff s set blocked_at = null, blocked_by = null, blocked_reason = null
   where s.id = p_staff_id and s.blocked_at is not null
     and s.tenant_id in (select public.tenants_with('team.write'));
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'співробітник не знайдений, не заблокований або немає права'; end if;
end; $$;
revoke all on function public.unblock_staff(uuid) from public;
grant execute on function public.unblock_staff(uuid) to authenticated;
