-- 0054 — инспектор как приглашаемая роль со сроком действия доступа.
--
-- ЧТО БЫЛО. Роль inspector в role_grants есть, права после 0035 сужены до одного
-- compliance.read — это правильно. Но выдать её живому проверяющему было нечем
-- (0050 закрыл), а главное — выданный доступ был вечным. Срок жизни ССЫЛКИ (72 ч,
-- 0050) и срок жизни ДОСТУПА — разные вещи: проверяющий пришёл, посмотрел, ушёл,
-- а членство осталось навсегда. Владелец обязан уметь дать доступ «на посмотреть».
--
-- ЧТО ДЕЛАЕМ.
--   * tenant_members.access_expires_at — момент, после которого членство есть, но
--     доступа нет. Строку не удаляем: кто и когда приходил с проверкой — история,
--     она должна остаться, и в audit_log ссылка на этого человека не повиснет.
--   * invitations.access_days — сколько дней доступа даёт приглашение (1..365).
--     accept_invitation превращает это в access_expires_at = now() + N дней.
--   * У приглашения с ролью inspector срок обязателен: если не задан явно, ставим
--     7 дней. Вечный инспектор возможен только если явно передать другую роль.
--   * Хук custom_access_token_hook НЕ ТРОГАЕМ ВООБЩЕ. В 0051 он был переписан один
--     раз так, чтобы вся логика «есть ли доступ» жила в public.member_access_ok —
--     здесь меняется только она. Это и был смысл того разделения.
--   * Продлить или обрубить доступ досрочно — обычный UPDATE
--     tenant_members.access_expires_at: политика требует team.write, а охранник
--     из 0052 такой UPDATE пропускает (роль и permissions не менялись).
--   * create_invitation получил пятый аргумент p_access_days. Старая четырёхаргументная
--     версия УДАЛЕНА, а не оставлена рядом: две перегрузки — это гарантированный
--     день отладки, когда вызов молча уйдёт не в ту.
--
-- ПРОВЕРЕНО ИСПОЛНЕНИЕМ (в транзакции с откатом):
--   инспектор в пределах срока: compliance_batches 8 строк, materials 0,
--     audit_log 15 (только санитарные журналы), tenants 1 — реестр без денег;
--   срок истёк: compliance_batches 0, materials 0, audit_log 0, tenants 0,
--     claims = {"perms":{},"modules":{},"memberships":{}} — не видит НИЧЕГО;
--   claims владельца при этом — {"...": ["*"]}, не изменились.
--
-- НЕ ТРОГАЕМ: role_grants (0034/0035), cron.job, Vault, compliance_*, охранники 0046.

alter table public.tenant_members add column access_expires_at timestamptz;
comment on column public.tenant_members.access_expires_at is
  'После этого момента членство остаётся в истории, а доступа нет. NULL = бессрочно.';

alter table public.invitations add column access_days int
  check (access_days is null or (access_days between 1 and 365));

create or replace function public.member_access_ok(p_tenant uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select not exists (
           select 1 from public.staff s
            where s.tenant_id = p_tenant and s.user_id = p_user and s.blocked_at is not null)
     and coalesce((select tm.access_expires_at from public.tenant_members tm
                    where tm.tenant_id = p_tenant and tm.user_id = p_user),
                  'infinity'::timestamptz) > now();
$$;
revoke all on function public.member_access_ok(uuid, uuid) from public;
grant execute on function public.member_access_ok(uuid, uuid) to authenticated, service_role, supabase_auth_admin;

drop function public.create_invitation(uuid, text, public.member_role, jsonb);
create or replace function public.create_invitation(
  p_tenant_id uuid, p_email text, p_role public.member_role,
  p_permissions jsonb default '{}'::jsonb, p_access_days int default null)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid(); v_role public.member_role; v_secret text;
  v_email extensions.citext := lower(trim(p_email))::extensions.citext;
  v_days int := coalesce(p_access_days, case when p_role = 'inspector' then 7 else null end);
begin
  if v_uid is null then raise exception 'не автентифіковано'; end if;
  if p_tenant_id not in (select public.tenants_with('team.write')) then
    raise exception 'немає права team.write у цьому закладі'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'некоректна пошта'; end if;
  if jsonb_typeof(coalesce(p_permissions,'{}'::jsonb)) <> 'object' then
    raise exception 'permissions має бути обєктом'; end if;
  select tm.role into v_role from public.tenant_members tm
   where tm.tenant_id = p_tenant_id and tm.user_id = v_uid;
  if v_role is null then raise exception 'ви не учасник цього закладу'; end if;
  if public.role_rank(p_role) > public.role_rank(v_role) then
    raise exception 'не можна запросити роль, вищу за власну (% > %)', p_role, v_role; end if;
  if exists (select 1 from public.tenant_members tm join public.profiles pr on pr.id = tm.user_id
              where tm.tenant_id = p_tenant_id and pr.email = v_email) then
    raise exception 'ця людина вже в закладі'; end if;
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (tenant_id, email, role, permissions, token_hash, invited_by, access_days)
  values (p_tenant_id, v_email, p_role, coalesce(p_permissions,'{}'::jsonb),
          encode(extensions.digest(v_secret, 'sha256'), 'hex'), v_uid, v_days)
  returning id, v_secret, invitations.expires_at into invitation_id, token, expires_at;
  return next;
end; $$;
revoke all on function public.create_invitation(uuid, text, public.member_role, jsonb, int) from public;
grant execute on function public.create_invitation(uuid, text, public.member_role, jsonb, int) to authenticated;

create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := auth.uid(); v_mail extensions.citext; v_hash text;
        v_inv public.invitations%rowtype; v_rows int;
begin
  if v_uid is null then raise exception 'не автентифіковано'; end if;
  select pr.email into v_mail from public.profiles pr where pr.id = v_uid;
  v_hash := encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex');
  update public.invitations i set status='accepted', accepted_at=now(), accepted_by=v_uid
   where i.token_hash = v_hash and i.status='pending' and i.expires_at > now() and i.email = v_mail
  returning i.* into v_inv;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'запрошення недійсне: не існує, вже використане, відкликане, протерміноване або виписане на іншу пошту'; end if;
  insert into public.tenant_members (tenant_id, user_id, role, permissions, invited_by, access_expires_at)
  values (v_inv.tenant_id, v_uid, v_inv.role, v_inv.permissions, v_inv.invited_by,
          case when v_inv.access_days is null then null else now() + make_interval(days => v_inv.access_days) end)
  on conflict (tenant_id, user_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'ви вже учасник цього закладу'; end if;
  return v_inv.tenant_id;
end; $$;
revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;
