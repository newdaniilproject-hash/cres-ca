-- 0052 — защита от самоблокировки заведения.
--
-- ЧТО БЫЛО. tenant_members правился одной политикой tenant_members_update «есть
-- team.write — делай что хочешь». Владелец мог понизить сам себя и остаться без
-- доступа к собственному заведению навсегда. Администратор мог переписать права
-- владельцу, поднять себе роль или выкинуть владельца из tenant_members. Никаких
-- проверок не было ни одной.
--
-- ЧТО ДЕЛАЕМ. Триггер public.tenant_members_guard_trg на INSERT/UPDATE/DELETE.
-- Он висит НАД политиками, поэтому его не обходят и SECURITY DEFINER-функции.
-- Запреты (все проверены попыткой, числа — в отчёте):
--   * никто не меняет СВОИ роль и permissions — это закрывает и «владелец понизил
--     себя», и «администратор выписал себе finances.write»;
--   * права владельца меняет только владелец — администратору отказ;
--   * нельзя выдать роль выше собственной (admin не сделает никого owner);
--   * последнего владельца нельзя убрать из заведения (DELETE) и нельзя понизить —
--     public.assert_not_last_owner из 0051;
--   * второго владельца завести нельзя. Это не новое правило: в базе с самого
--     начала стоит частичный уникальный индекс tenant_members_single_owner_idx
--     (один owner на заведение). Раньше нарушение вылезало как «duplicate key» —
--     теперь отдаётся понятным текстом. Побочно это значит, что приглашение с
--     ролью owner из 0050 всегда упрётся сюда: смена владельца — только через
--     transfer_ownership.
--
-- ДВЕ ЩЕЛИ, СДЕЛАННЫЕ НАРОЧНО:
--   * app.purging_account = 'on' — удаление собственного аккаунта (0024), иначе
--     delete_my_account перестал бы работать;
--   * app.ownership_transfer = 'on' — внутри transfer_ownership, иначе владелец не
--     смог бы понизить сам себя даже правильным путём.
--   * auth.uid() is null — служебные подключения (service_role, крон, миграции).
--
-- transfer_ownership(p_tenant_id, p_to_user_id): понижает текущего владельца до
-- admin и поднимает выбранного участника до owner. Порядок именно такой и не
-- случайный: из-за tenant_members_single_owner_idx обратный порядок падает на
-- уникальном индексе — проверено, первая версия функции именно так и упала.
-- Принимающий не должен быть заблокирован или с протухшим доступом — иначе
-- заведение осталось бы с владельцем без доступа.
--
-- НЕ ТРОГАЕМ: role_grants (0034), cron.job, Vault, compliance_*, охранники из 0046.

create or replace function public.tenant_members_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.member_role;
  v_row public.tenant_members%rowtype := coalesce(new, old);
begin
  if coalesce(current_setting('app.purging_account', true), 'off') = 'on'
     or coalesce(current_setting('app.ownership_transfer', true), 'off') = 'on'
     or v_actor is null then
    return v_row;
  end if;
  select tm.role into v_actor_role from public.tenant_members tm
   where tm.tenant_id = v_row.tenant_id and tm.user_id = v_actor;

  if tg_op = 'INSERT' then
    if new.role = 'owner' and exists (select 1 from public.tenant_members tm
         where tm.tenant_id = new.tenant_id and tm.role = 'owner') then
      raise exception 'у закладі може бути лише один власник; скористайтеся transfer_ownership';
    end if;
    if v_actor_role is not null and public.role_rank(new.role) > public.role_rank(v_actor_role) then
      raise exception 'не можна видати роль, вищу за власну (% > %)', new.role, v_actor_role;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.assert_not_last_owner(old.tenant_id, old.user_id, 'прибрати його із закладу не можна');
    return old;
  end if;

  if new.role is not distinct from old.role and new.permissions is not distinct from old.permissions then
    return new;
  end if;
  if new.user_id = v_actor then
    raise exception 'не можна змінювати власні права; передайте володіння або попросіть іншого власника';
  end if;
  if old.role = 'owner' and v_actor_role is distinct from 'owner' then
    raise exception 'права власника може змінювати лише власник';
  end if;
  if public.role_rank(new.role) > public.role_rank(coalesce(v_actor_role,'viewer')) then
    raise exception 'не можна видати роль, вищу за власну (% > %)', new.role, v_actor_role;
  end if;
  if old.role = 'owner' and new.role <> 'owner' then
    perform public.assert_not_last_owner(old.tenant_id, old.user_id, 'понизити його не можна');
  end if;
  return new;
end; $$;
revoke all on function public.tenant_members_guard() from public;
create trigger tenant_members_guard_trg before insert or update or delete on public.tenant_members
  for each row execute function public.tenant_members_guard();

create or replace function public.transfer_ownership(p_tenant_id uuid, p_to_user_id uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := auth.uid(); v_rows int;
begin
  if v_uid is null then raise exception 'не автентифіковано'; end if;
  if p_to_user_id = v_uid then raise exception 'ви вже власник'; end if;
  if not exists (select 1 from public.tenant_members tm
                  where tm.tenant_id = p_tenant_id and tm.user_id = v_uid and tm.role = 'owner') then
    raise exception 'передати володіння може лише власник закладу'; end if;
  if not exists (select 1 from public.tenant_members tm
                  where tm.tenant_id = p_tenant_id and tm.user_id = p_to_user_id) then
    raise exception 'ця людина не є учасником закладу'; end if;
  if not public.member_access_ok(p_tenant_id, p_to_user_id) then
    raise exception 'ця людина заблокована або її доступ протермінований'; end if;
  perform set_config('app.ownership_transfer', 'on', true);
  update public.tenant_members tm set role = 'admin'
   where tm.tenant_id = p_tenant_id and tm.user_id = v_uid;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'не вдалося понизити попереднього власника'; end if;
  update public.tenant_members tm set role = 'owner'
   where tm.tenant_id = p_tenant_id and tm.user_id = p_to_user_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'не вдалося призначити нового власника'; end if;
  perform set_config('app.ownership_transfer', 'off', true);
end; $$;
revoke all on function public.transfer_ownership(uuid, uuid) from public;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
