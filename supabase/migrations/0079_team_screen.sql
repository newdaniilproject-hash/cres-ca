-- ===========================================================================
-- 0079. То, без чего экран команды нельзя было включить. Шаг 4, пункт В
-- ===========================================================================
--
-- Экран команды собирается из уже готовых функций: приглашение (0050),
-- блокировка (0051), передача владения (0052), срок доступа (0054),
-- журнал и сеансы (0076), шаблоны и потолок скидки (0077). Три вещи
-- при сборке оказались недостающими или сломанными — они здесь.
--
-- ── А. ШАБЛОН МОГ ВЫБИТЬ ЧЕЛОВЕКА ИЗ ПРОДУКТА НАВСЕГДА ───────────────────
--
-- Найдено при сборке экрана, не тестом. В 0077 у `permission_templates`
-- умолчание колонки `permissions` — `'[]'`, то есть МАССИВ. А
-- `tenant_members.permissions` — это ОБЪЕКТ вида {"finances.read": true}:
-- его разбирает `jsonb_each_text` в `custom_access_token_hook`.
--
-- `apply_permission_template` переносит одно в другое как есть. Значит
-- шаблон, созданный без явного указания прав, кладёт участнику массив,
-- и со следующего входа хук выдачи токена падает на `jsonb_each_text`
-- с «cannot deconstruct an array as an object». Токен не выдаётся —
-- человек не может войти. Не «видит меньше разделов», а не входит,
-- и починить это из интерфейса нельзя, потому что интерфейс за токеном.
--
-- Лечится умолчанием и ограничением формы: то же самое ограничение
-- уже стоит на `invitations.permissions` (0050) — здесь его просто забыли.
--
-- ── Б. ЧЕЛОВЕКА БЕЗ КАРТОЧКИ МАСТЕРА НЕЛЬЗЯ БЫЛО ЗАБЛОКИРОВАТЬ ───────────
--
-- `block_staff` (0051) блокирует строку в `staff`, и `member_access_ok`
-- смотрит туда же. Карточка мастера есть у того, кто принимает записи.
-- У бухгалтера, инспектора и приглашённого «на посмотреть» её нет —
-- и отобрать у них доступ было нечем вообще. Кнопка «заблокувати» на
-- экране команды для половины ролей не имела бы обработчика.
--
-- Признак блокировки переезжает на `tenant_members` — туда, где живёт
-- само членство. Старая проверка по `staff` ОСТАЁТСЯ: карточка мастера
-- может существовать без учётной записи, и её блокировка — это отдельное
-- «этот человек больше не работает», которое видно в записях.
--
-- ── В. ЭКРАНУ НУЖЕН ОДИН ЗАПРОС, А НЕ ШЕСТЬ ──────────────────────────────
--
-- `team_overview` собирает участника целиком: имя, почта, роль, тонкая
-- выдача, потолок скидки, блокировка, срок доступа, карточка мастера.
-- Отдельными запросами это шесть обращений и join профилей на клиенте.
-- ===========================================================================

-- ── А. Форма прав в шаблоне ───────────────────────────────────────────────

update public.permission_templates
   set permissions = '{}'::jsonb
 where jsonb_typeof(permissions) <> 'object';

alter table public.permission_templates
  alter column permissions set default '{}'::jsonb;

alter table public.permission_templates
  drop constraint if exists permission_templates_perms_object;
alter table public.permission_templates
  add constraint permission_templates_perms_object
  check (jsonb_typeof(permissions) = 'object');

-- И то же самое на самой цели — `tenant_members.permissions`. Ограничения
-- там не было с 0001, и это не теория: собственный тест 09_team.sql писал
-- туда массив `["stock.read"]` и проходил зелёным, потому что хук выдачи
-- токена в тесте не звался. То есть форму, которая ломает вход, стенд
-- считал допустимой.
--
-- Ставится последним рубежом: шаблон, приглашение и ручная правка теперь
-- проверяются каждый у себя, но колонка обязана защищаться сама —
-- к ней ходят три пути, а завтра появится четвёртый.
update public.tenant_members set permissions = '{}'::jsonb
 where jsonb_typeof(permissions) <> 'object';

alter table public.tenant_members drop constraint if exists tenant_members_perms_object;
alter table public.tenant_members add constraint tenant_members_perms_object
  check (jsonb_typeof(permissions) = 'object');

-- ── Б. Блокировка участника ───────────────────────────────────────────────

alter table public.tenant_members
  add column if not exists blocked_at     timestamptz,
  add column if not exists blocked_by     uuid references public.profiles(id) on delete set null,
  add column if not exists blocked_reason text;

alter table public.tenant_members drop constraint if exists tenant_members_blocked_shape;
alter table public.tenant_members add constraint tenant_members_blocked_shape
  check ((blocked_at is null) = (blocked_by is null));

comment on column public.tenant_members.blocked_at is
  'Доступ отобран у участника. Отдельно от staff.blocked_at: карточка мастера может жить без учётной записи.';

-- Проверка доступа расширяется третьим условием. Порядок условий не
-- случаен: сначала дешёвое чтение своей же строки, потом обращение
-- к staff. Функция зовётся хуком на каждую выдачу токена.
create or replace function public.member_access_ok(p_tenant uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $fn$
  select coalesce((select tm.blocked_at is null from public.tenant_members tm
                    where tm.tenant_id = p_tenant and tm.user_id = p_user), true)
     and not exists (
           select 1 from public.staff s
            where s.tenant_id = p_tenant and s.user_id = p_user and s.blocked_at is not null)
     and coalesce((select tm.access_expires_at from public.tenant_members tm
                    where tm.tenant_id = p_tenant and tm.user_id = p_user),
                  'infinity'::timestamptz) > now();
$fn$;
revoke all on function public.member_access_ok(uuid, uuid) from public, anon;
grant execute on function public.member_access_ok(uuid, uuid)
  to authenticated, service_role, supabase_auth_admin;

-- Блокировка идёт ОБЫЧНЫМ UPDATE по `tenant_members` намеренно: так она
-- проходит через защиту 0076 (последнего владельца не заблокировать),
-- попадает в неизменяемый журнал прав и рвёт сеансы тем же триггером.
-- Отдельная логика тут означала бы второй путь изменения доступа,
-- который журнал не видит.
create or replace function public.block_member(
  p_tenant_id uuid, p_user_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path to '' as $fn$
declare v_uid uuid := auth.uid(); v_rows int;
begin
  if v_uid is null then raise exception 'не автентифіковано'; end if;
  if p_tenant_id not in (select public.tenants_with('team.write')) then
    raise exception 'немає права team.write у цьому закладі';
  end if;
  if p_user_id = v_uid then
    raise exception 'себе заблокувати не можна';
  end if;
  perform public.assert_not_last_owner(p_tenant_id, p_user_id, 'заблокувати його не можна');

  update public.tenant_members m
     set blocked_at = now(), blocked_by = v_uid, blocked_reason = p_reason
   where m.tenant_id = p_tenant_id and m.user_id = p_user_id and m.blocked_at is null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'учасника не знайдено або він уже заблокований'; end if;

  -- Карточка мастера гасится вместе с доступом: иначе человек пропадает
  -- из кабинета, но остаётся в списке, на которого можно записать клиента.
  update public.staff s
     set blocked_at = now(), blocked_by = v_uid, blocked_reason = p_reason
   where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.blocked_at is null;
end $fn$;

revoke all on function public.block_member(uuid, uuid, text) from public, anon;
grant execute on function public.block_member(uuid, uuid, text) to authenticated;

create or replace function public.unblock_member(p_tenant_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path to '' as $fn$
declare v_rows int;
begin
  if auth.uid() is null then raise exception 'не автентифіковано'; end if;
  if p_tenant_id not in (select public.tenants_with('team.write')) then
    raise exception 'немає права team.write у цьому закладі';
  end if;

  update public.tenant_members m
     set blocked_at = null, blocked_by = null, blocked_reason = null
   where m.tenant_id = p_tenant_id and m.user_id = p_user_id and m.blocked_at is not null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'учасника не знайдено або він не заблокований'; end if;

  update public.staff s
     set blocked_at = null, blocked_by = null, blocked_reason = null
   where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.blocked_at is not null;
end $fn$;

revoke all on function public.unblock_member(uuid, uuid) from public, anon;
grant execute on function public.unblock_member(uuid, uuid) to authenticated;

-- ── В. Состав команды одним запросом ──────────────────────────────────────
--
-- SECURITY DEFINER, потому что читает `profiles` чужих людей: почта
-- сотрудника видна только своим. Изоляцию проверяет собственный WHERE
-- по `team.read` — как у представлений из 0078.
create or replace function public.team_overview(p_tenant_id uuid)
returns table (
  user_id           uuid,
  full_name         text,
  email             text,
  role              public.member_role,
  permissions       jsonb,
  discount_cap_pct  smallint,
  effective_cap_pct smallint,
  blocked_at        timestamptz,
  blocked_reason    text,
  access_expires_at timestamptz,
  staff_id          uuid,
  joined_at         timestamptz
)
language sql stable security definer set search_path to '' as $fn$
  select m.user_id,
         p.full_name,
         p.email::text,
         m.role,
         m.permissions,
         m.discount_cap_pct,
         coalesce(m.discount_cap_pct, c.cap_pct, 0)::smallint,
         coalesce(m.blocked_at, s.blocked_at),
         coalesce(m.blocked_reason, s.blocked_reason),
         m.access_expires_at,
         s.id,
         m.created_at
    from public.tenant_members m
    left join public.profiles p           on p.id = m.user_id
    left join public.role_discount_caps c on c.role = m.role
    left join public.staff s              on s.tenant_id = m.tenant_id and s.user_id = m.user_id
   where m.tenant_id = p_tenant_id
     and p_tenant_id in (select public.tenants_with('team.read'))
   order by public.role_rank(m.role) desc, p.full_name nulls last;
$fn$;

revoke all on function public.team_overview(uuid) from public, anon;
grant execute on function public.team_overview(uuid) to authenticated;

comment on function public.team_overview(uuid) is
  'Состав команды для экрана: членство, профиль, потолок скидки, блокировка, карточка мастера. SECURITY DEFINER — изоляцию проверяет собственный WHERE по team.read.';

-- ── Права, которых никто не выдавал ───────────────────────────────────────
--
-- `alter default privileges` в облаке Supabase выдаёт ALL на каждый новый
-- объект ролям anon и authenticated. Ловилось пять раз (0036, 0060, 0072,
-- 0073, 0076). Новых таблиц здесь нет, но колонки добавлены — а колонка
-- наследует табличное право, поэтому проверяем явно то, что и так должно
-- быть: writes по tenant_members идут политикой, отдельного гранта не надо.
revoke all on table public.permission_templates from anon;
