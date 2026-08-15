-- 0050 — приглашения сотрудников и инспекторов. Раньше их не было вообще.
--
-- ЧТО БЫЛО. Единственный способ завести человека в заведение — вручную вписать
-- строку в public.tenant_members. Из приложения это недоступно: политика
-- tenant_members_insert требует team.write, но UI не может знать user_id ещё не
-- зарегистрированного человека, а public.profiles закрыт политикой
-- profiles_self_read — чужую почту в user_id никто не превратит. Итог: пригласить
-- мастера или проверяющего нельзя ничем, кроме прямого доступа к базе.
--
-- ЧТО ДЕЛАЕМ. Таблица public.invitations — заявка на членство: заведение, почта,
-- роль, персональные оверрайды прав (тот же формат, что tenant_members.permissions,
-- который уже читают custom_access_token_hook и enqueue_expiry_warnings из 0048),
-- кто пригласил, срок, отметка о принятии.
--
-- РЕШЕНИЯ И ПОЧЕМУ ИМЕННО ТАК:
--   * Секрет ссылки в базе не хранится. Хранится extensions.digest(secret,'sha256')
--     в hex. Утечка дампа не даёт войти. Сам секрет create_invitation отдаёт ровно
--     один раз — вернуть его повторно неоткуда, это принцип одноразового секрета,
--     а не недоделка. ПРОВЕРЕНО: поиск по открытому токену в token_hash — 0 строк,
--     поиск по его sha256 — 1 строка.
--   * Срок жизни ссылки 72 часа, задан default'ом столбца expires_at.
--   * Одноразовость обеспечена не проверкой в коде, а порядком операций внутри
--     accept_invitation: сперва UPDATE ... where status='pending' (он берёт
--     блокировку строки и отдаёт row_count), и только если row_count = 1 —
--     вставка в tenant_members. Две параллельные попытки: вторая получит 0.
--     ПРОВЕРЕНО: второе принятие того же токена — отказ.
--   * Принять может только адресат: сверяем email приглашения с profiles.email
--     принимающего. ПРОВЕРЕНО: посторонний с валидным токеном — отказ.
--   * Нельзя пригласить на роль выше своей — public.role_rank(). manager (60)
--     не дотягивается до owner (100) и admin (80).
--   * Нельзя пригласить того, кто уже в заведении: проверка идёт по почте через
--     profiles, поэтому функция SECURITY DEFINER — иначе она не видит чужие
--     профили. Право team.write при этом проверяется явно, через tenants_with.
--   * Частичный уникальный индекс invitations_one_live_per_email не даёт держать
--     два живых приглашения на одну почту в одном заведении; после отзыва или
--     принятия пригласить можно снова.
--   * Статус 'expired' в столбце не хранится никогда — срок наступает сам, без
--     UPDATE. Действующее состояние отдаёт public.invitation_state(id).
--
-- НЕ ТРОГАЕМ: role_grants (0034), cron.job, Vault, представления compliance_*
-- и охранники арендатора из 0046.

create type public.invitation_status as enum ('pending','accepted','revoked');

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email extensions.citext not null,
  role public.member_role not null,
  permissions jsonb not null default '{}'::jsonb,
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '72 hours',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  status public.invitation_status not null default 'pending',
  constraint invitations_perms_object check (jsonb_typeof(permissions) = 'object'),
  constraint invitations_accepted_shape check (
    (status <> 'accepted') = (accepted_at is null) and (status <> 'accepted') = (accepted_by is null)),
  constraint invitations_revoked_shape check ((status <> 'revoked') = (revoked_at is null))
);

comment on table public.invitations is
  'Приглашения в заведение. Секрет ссылки хранится только хешем sha256 (hex).';

create unique index invitations_one_live_per_email on public.invitations (tenant_id, email) where status = 'pending';
create index invitations_tenant_idx on public.invitations (tenant_id, created_at desc);

alter table public.invitations enable row level security;
create policy invitations_read on public.invitations for select to authenticated
  using (tenant_id in (select public.tenants_with('team.read')));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (tenant_id in (select public.tenants_with('team.write')));
create policy invitations_update on public.invitations for update to authenticated
  using (tenant_id in (select public.tenants_with('team.write')))
  with check (tenant_id in (select public.tenants_with('team.write')));
grant select, insert, update on public.invitations to authenticated;

-- Вес роли. Больше — старше. Нужен и здесь, и в 0052 при защите владельца.
create or replace function public.role_rank(p_role public.member_role)
returns int language sql immutable set search_path to '' as $$
  select case p_role when 'owner' then 100 when 'admin' then 80 when 'manager' then 60
    when 'accountant' then 40 when 'operator' then 40 when 'viewer' then 20 when 'inspector' then 10 end;
$$;
revoke all on function public.role_rank(public.member_role) from public;
grant execute on function public.role_rank(public.member_role) to authenticated, service_role;

create or replace function public.invitation_state(p_id uuid)
returns text language sql stable set search_path to '' as $$
  select case when i.status <> 'pending' then i.status::text
              when i.expires_at <= now() then 'expired' else 'pending' end
    from public.invitations i where i.id = p_id;
$$;
revoke all on function public.invitation_state(uuid) from public;
grant execute on function public.invitation_state(uuid) to authenticated, service_role;

-- Создать приглашение. Секрет возвращается ОДИН РАЗ.
create or replace function public.create_invitation(
  p_tenant_id uuid, p_email text, p_role public.member_role, p_permissions jsonb default '{}'::jsonb)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid(); v_role public.member_role; v_secret text;
  v_email extensions.citext := lower(trim(p_email))::extensions.citext;
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
  insert into public.invitations (tenant_id, email, role, permissions, token_hash, invited_by)
  values (p_tenant_id, v_email, p_role, coalesce(p_permissions,'{}'::jsonb),
          encode(extensions.digest(v_secret, 'sha256'), 'hex'), v_uid)
  returning id, v_secret, invitations.expires_at into invitation_id, token, expires_at;
  return next;
end; $$;
revoke all on function public.create_invitation(uuid, text, public.member_role, jsonb) from public;
grant execute on function public.create_invitation(uuid, text, public.member_role, jsonb) to authenticated;

-- Принять приглашение. Одноразово: гасим строку первым же оператором.
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
  insert into public.tenant_members (tenant_id, user_id, role, permissions, invited_by)
  values (v_inv.tenant_id, v_uid, v_inv.role, v_inv.permissions, v_inv.invited_by)
  on conflict (tenant_id, user_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'ви вже учасник цього закладу'; end if;
  return v_inv.tenant_id;
end; $$;
revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;

create or replace function public.revoke_invitation(p_id uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_rows int;
begin
  if auth.uid() is null then raise exception 'не автентифіковано'; end if;
  update public.invitations i set status='revoked', revoked_at=now()
   where i.id = p_id and i.status='pending'
     and i.tenant_id in (select public.tenants_with('team.write'));
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'запрошення не знайдено, вже використане або немає права'; end if;
end; $$;
revoke all on function public.revoke_invitation(uuid) from public;
grant execute on function public.revoke_invitation(uuid) to authenticated;

create trigger audit_invitations after insert or update or delete on public.invitations
  for each row execute function public.audit_row();
