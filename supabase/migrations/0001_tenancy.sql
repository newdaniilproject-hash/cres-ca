-- 0001_tenancy.sql
-- Фундамент мультиарендности. Применяется ПЕРВОЙ и не изменяется задним числом.
--
-- Главная идея: арендатор (tenant) — это один продавец. Склад, каталог, заказы,
-- деньги и настройки всегда принадлежат ровно одному арендатору. Витрина
-- включается флагом storefront_enabled, поэтому «склад для одного ФОПа» и
-- «магазин на маркетплейсе» — это одна и та же запись в разных состояниях,
-- а не две системы с миграцией между ними.
--
-- Роль пользователя в конкретном арендаторе кладётся в JWT (см. хук ниже),
-- поэтому RLS не делает запросов к таблицам на каждой строке, а читает claim.
-- Это прямой ответ на боль прошлого опыта: там профиль читался из БД на каждый рендер,
-- оборачивался в таймауты и в итоге обходился service-role ключом.

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ─────────────────────────────────────────────────────────────────────────────
-- Типы
-- ─────────────────────────────────────────────────────────────────────────────

-- Что продаёт арендатор. Влияет на подсказки в каталоге и на фильтры
-- маркетплейса, но НЕ разделяет код: товары и услуги живут в одной таблице.
create type public.tenant_kind as enum ('goods', 'services', 'both');

-- draft    — зарегистрировался, ещё ничего не настроил
-- active   — работает
-- suspended— заблокирован платформой (неоплата, нарушение)
-- archived — ушёл; данные храним, доступ закрыт
create type public.tenant_status as enum ('draft', 'active', 'suspended', 'archived');

-- Роли внутри одного арендатора. Пользователь может иметь РАЗНЫЕ роли
-- в разных арендаторах — поэтому роль живёт в связке, а не в профиле.
--   owner      — ФОП/владелец, полный доступ, включая деньги и состав команды
--   admin      — правая рука владельца, всё кроме передачи владения
--   manager    — операционка + клиенты + отчёты, без настроек биллинга
--   operator   — склад, сборка, отгрузка; денег не видит
--   accountant — только финансы и документы
--   viewer     — только чтение
create type public.member_role as enum
  ('owner', 'admin', 'manager', 'operator', 'accountant', 'viewer');

-- ─────────────────────────────────────────────────────────────────────────────
-- Арендаторы
-- ─────────────────────────────────────────────────────────────────────────────

create table public.tenants (
  id                 uuid primary key default gen_random_uuid(),

  -- Поддомен на платформе: <slug>.<основной домен>. Меняется редко и с
  -- редиректом, поэтому уникальность глобальная и это осознанно.
  slug               citext not null unique
                       check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),

  name               text not null check (length(btrim(name)) > 0),
  kind               public.tenant_kind   not null default 'goods',
  status             public.tenant_status not null default 'draft',

  -- Короткое описание ниши: используется поиском маркетплейса,
  -- чтобы продавца было проще найти. Заполняется при регистрации.
  tagline            text,
  description        text,

  -- Реквизиты ФОПа. Нужны для документов и договора с платформой.
  -- Платежи принимает сам продавец, поэтому банковских данных здесь нет —
  -- они лежат в его собственном эквайринге (см. ADR 0005).
  legal_name         text,
  tax_id             text,
  contact_email      citext,
  contact_phone      text,

  -- КЛЮЧЕВОЙ ФЛАГ. false = у арендатора работает только внутренняя часть
  -- (склад, заказы, учёт), публичной витрины нет. true = магазин опубликован
  -- на маркетплейсе. «Перенос склада в маркетплейс» — это перевод флага,
  -- а не миграция данных.
  storefront_enabled boolean not null default false,

  -- Отображать ли товары арендатора в общем каталоге маркетплейса.
  -- Отдельно от storefront_enabled: магазин может быть опубликован,
  -- но временно скрыт из общей выдачи.
  listed_in_catalog  boolean not null default false,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  activated_at       timestamptz
);

comment on column public.tenants.storefront_enabled is
  'Публичная витрина включена. false = режим «только склад/учёт» для первого ФОПа.';

create index tenants_status_idx  on public.tenants (status)
  where status = 'active';
create index tenants_listed_idx  on public.tenants (listed_in_catalog)
  where listed_in_catalog;

-- Собственные домены продавцов (платная опция).
-- Поддомен платформы живёт в tenants.slug и здесь НЕ дублируется.
create table public.tenant_domains (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  hostname     citext not null unique
                 check (hostname ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  is_primary   boolean not null default false,
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- Ровно один основной домен на арендатора.
create unique index tenant_domains_one_primary_idx
  on public.tenant_domains (tenant_id)
  where is_primary;

create index tenant_domains_tenant_idx on public.tenant_domains (tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Люди
-- ─────────────────────────────────────────────────────────────────────────────

-- Профиль пользователя платформы. Здесь НЕТ роли и НЕТ флага is_admin:
-- права всегда относятся к конкретному арендатору (см. tenant_members).
-- Именно смешение «глобальный админ» и «роль» породило в прошлом проекте четыре
-- параллельных механизма прав.
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        citext,
  full_name    text,
  phone        text,
  avatar_url   text,
  locale       text not null default 'uk' check (locale in ('uk', 'ru', 'en')),

  -- Сотрудник платформы (поддержка, модерация). Единственная глобальная
  -- привилегия в системе. Ставится только вручную и логируется.
  is_staff     boolean not null default false,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.tenant_members (
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  role         public.member_role not null default 'viewer',

  -- Точечные исключения из роли: {"finances.read": true, "orders.write": false}.
  -- Пусто в 95% случаев. Роль остаётся основным механизмом.
  permissions  jsonb not null default '{}'::jsonb,

  invited_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),

  primary key (tenant_id, user_id)
);

create index tenant_members_user_idx on public.tenant_members (user_id);

-- У арендатора всегда есть ровно один владелец.
create unique index tenant_members_single_owner_idx
  on public.tenant_members (tenant_id)
  where role = 'owner';

-- ─────────────────────────────────────────────────────────────────────────────
-- Права как данные
-- ─────────────────────────────────────────────────────────────────────────────
-- Одна таблица — единственный источник правды о том, что может роль.
-- Из неё выводятся: RLS-политики (через tenant_can), серверные проверки
-- и навигация в интерфейсе. Никакого хардкода email и никаких «исторических»
-- хелперов, наслоённых поверх новых.

create table public.role_grants (
  role       public.member_role not null,
  permission text not null,
  primary key (role, permission)
);

insert into public.role_grants (role, permission) values
  -- admin: всё, кроме передачи владения и удаления магазина
  ('admin','catalog.read'),   ('admin','catalog.write'),
  ('admin','orders.read'),    ('admin','orders.write'),
  ('admin','stock.read'),     ('admin','stock.write'),
  ('admin','customers.read'), ('admin','customers.write'),
  ('admin','finances.read'),  ('admin','finances.write'),
  ('admin','storefront.read'),('admin','storefront.write'),
  ('admin','team.read'),      ('admin','team.write'),
  ('admin','settings.read'),  ('admin','settings.write'),

  -- manager: операционка и клиенты, финансы только на чтение
  ('manager','catalog.read'),   ('manager','catalog.write'),
  ('manager','orders.read'),    ('manager','orders.write'),
  ('manager','stock.read'),     ('manager','stock.write'),
  ('manager','customers.read'), ('manager','customers.write'),
  ('manager','finances.read'),
  ('manager','storefront.read'),
  ('manager','team.read'),
  ('manager','settings.read'),

  -- operator: склад и сборка заказов. Денег и клиентской базы не видит.
  ('operator','catalog.read'),
  ('operator','orders.read'),   ('operator','orders.write'),
  ('operator','stock.read'),    ('operator','stock.write'),

  -- accountant: только деньги и документы
  ('accountant','finances.read'), ('accountant','finances.write'),
  ('accountant','orders.read'),
  ('accountant','catalog.read'),

  -- viewer: только чтение, без денег
  ('viewer','catalog.read'),
  ('viewer','orders.read'),
  ('viewer','stock.read'),
  ('viewer','customers.read');
-- owner намеренно отсутствует: ему разрешено всё (см. tenant_can).

-- ─────────────────────────────────────────────────────────────────────────────
-- JWT: роли И ГОТОВЫЕ РАЗРЕШЕНИЯ пользователя попадают в токен
-- ─────────────────────────────────────────────────────────────────────────────
-- Подключается в Supabase: Authentication → Hooks → Customize Access Token.
-- После этого:
--   app_metadata.memberships = {"<tenant_id>": "<role>", ...}
--   app_metadata.perms       = {"<tenant_id>": ["catalog.read", ...], ...}
--                              у владельца — ["*"]
--
-- ПОЧЕМУ РАЗРЕШЕНИЯ РАЗВОРАЧИВАЮТСЯ ЗДЕСЬ, А НЕ ПРИ ПРОВЕРКЕ.
-- Проверка права выполняется на КАЖДОЙ строке каждого запроса. Если внутри неё
-- есть обращение к таблице (role_grants, tenant_members), то список из 500
-- позиций склада — это 1000 лишних обращений к диску. Здесь же разворачивание
-- происходит один раз при выдаче токена, то есть раз в час на пользователя.
-- role_grants остаётся источником правды и правится как данные (ADR 0002),
-- просто читается в момент выдачи токена, а не в момент показа строки.
--
-- Плата за это: изменение прав сотрудника вступает в силу при обновлении
-- токена. Если нужно немедленно — сессии сотрудника завершаются принудительно
-- (это и так обязательное требование при смене роли, см. docs/DOMAIN.md).

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims      jsonb;
  v_memberships jsonb;
  v_perms       jsonb;
  v_is_staff    boolean;
  v_uid         uuid := (event->>'user_id')::uuid;
begin
  select coalesce(jsonb_object_agg(tm.tenant_id::text, tm.role::text), '{}'::jsonb)
    into v_memberships
    from public.tenant_members tm
   where tm.user_id = v_uid;

  -- Итоговый набор прав = права роли, минус точечные запреты, плюс точечные
  -- разрешения. Владельцу — «*», чтобы не раздувать токен полным перечнем.
  select coalesce(jsonb_object_agg(x.tenant_id::text, x.perms), '{}'::jsonb)
    into v_perms
    from (
      select tm.tenant_id,
             case
               when tm.role = 'owner' then '["*"]'::jsonb
               else coalesce((
                 select jsonb_agg(p.permission)
                   from (
                     select g.permission
                       from public.role_grants g
                      where g.role = tm.role
                        and coalesce(tm.permissions ->> g.permission, 'true') <> 'false'
                     union
                     select o.key
                       from jsonb_each_text(tm.permissions) as o(key, value)
                      where o.value = 'true'
                   ) p
               ), '[]'::jsonb)
             end as perms
        from public.tenant_members tm
       where tm.user_id = v_uid
    ) x;

  select coalesce(p.is_staff, false)
    into v_is_staff
    from public.profiles p
   where p.id = v_uid;

  v_claims := coalesce(event->'claims', '{}'::jsonb);

  if v_claims->'app_metadata' is null then
    v_claims := jsonb_set(v_claims, '{app_metadata}', '{}'::jsonb);
  end if;

  v_claims := jsonb_set(v_claims, '{app_metadata,memberships}', v_memberships);
  v_claims := jsonb_set(v_claims, '{app_metadata,perms}', v_perms);
  v_claims := jsonb_set(v_claims, '{app_metadata,is_staff}', to_jsonb(coalesce(v_is_staff, false)));

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Хелперы RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- НИ ОДИН из них не обращается к таблицам — только к разобранному JWT.
-- Это обязательное условие скорости: политика выполняется на каждой строке,
-- поэтому любое обращение к диску внутри неё умножается на размер выборки.
-- Все помечены STABLE, чтобы Postgres мог вычислить результат один раз
-- на запрос, а не на строку.

create or replace function public.jwt_memberships()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' -> 'memberships',
    '{}'::jsonb
  );
$$;

create or replace function public.is_platform_staff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' ->> 'is_staff')::boolean,
    false
  );
$$;

-- Роль текущего пользователя в конкретном арендаторе; null если не участник.
create or replace function public.tenant_role(p_tenant uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(public.jwt_memberships() ->> p_tenant::text, '');
$$;

create or replace function public.is_tenant_member(p_tenant uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.tenant_role(p_tenant) is not null;
$$;

-- Готовый набор прав пользователя по арендаторам, из токена.
create or replace function public.jwt_perms()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' -> 'perms',
    '{}'::jsonb
  );
$$;

-- Главная функция авторизации. Используется и в RLS, и в серверном коде.
-- Ни одного обращения к таблице: всё уже развёрнуто в токене хуком выше.
create or replace function public.tenant_can(p_tenant uuid, p_permission text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (public.jwt_perms() -> p_tenant::text) @> to_jsonb(p_permission)
      or (public.jwt_perms() -> p_tenant::text) @> '"*"'::jsonb,
    false
  );
$$;

-- Список арендаторов, где у пользователя есть данное право.
--
-- ЭТО ГЛАВНАЯ ФУНКЦИЯ ДЛЯ ПОЛИТИК, а не tenant_can. Разница принципиальная:
--   using (public.tenant_can(tenant_id, 'stock.read'))          -- на каждой строке
--   using (tenant_id in (select public.tenants_with('stock.read'))) -- один раз
-- Во втором случае подзапрос не зависит от строки, Postgres выносит его
-- в InitPlan и выполняет ровно один раз на весь запрос. На списке из
-- десяти тысяч позиций склада это разница между «мгновенно» и «крутится».
-- tenant_can остаётся для серверного кода и проверок по одному арендатору.
create or replace function public.tenants_with(p_permission text)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select (e.key)::uuid
    from jsonb_each(public.jwt_perms()) as e(key, value)
   where e.value @> to_jsonb(p_permission)
      or e.value @> '"*"'::jsonb;
$$;

-- Все арендаторы пользователя, без учёта конкретного права.
create or replace function public.my_tenants()
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select (e.key)::uuid from jsonb_each(public.jwt_memberships()) as e(key, value);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Триггеры
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tenants_touch
  before update on public.tenants
  for each row execute function public.touch_updated_at();

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Профиль заводится автоматически при регистрации.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.tenants        enable row level security;
alter table public.tenant_domains enable row level security;
alter table public.profiles       enable row level security;
alter table public.tenant_members enable row level security;
alter table public.role_grants    enable row level security;

-- Форма записи политик здесь везде одна и та же и выбрана не по вкусу:
-- «столбец in (select функция(...))» вычисляется Postgres один раз на запрос,
-- «функция(столбец)» — на каждой строке. См. комментарий к tenants_with.
-- Вызовы auth.uid() и is_platform_staff() обёрнуты в (select ...) по той же
-- причине: иначе они пересчитываются построчно.

-- Публично видна карточка только опубликованного магазина.
create policy tenants_public_read on public.tenants
  for select to anon, authenticated
  using (status = 'active' and storefront_enabled);

create policy tenants_member_read on public.tenants
  for select to authenticated
  using (id in (select public.my_tenants()) or (select public.is_platform_staff()));

create policy tenants_member_update on public.tenants
  for update to authenticated
  using       (id in (select public.tenants_with('settings.write')))
  with check  (id in (select public.tenants_with('settings.write')));

create policy tenant_domains_public_read on public.tenant_domains
  for select to anon, authenticated
  using (verified_at is not null);

create policy tenant_domains_manage on public.tenant_domains
  for all to authenticated
  using      (tenant_id in (select public.tenants_with('settings.write')))
  with check (tenant_id in (select public.tenants_with('settings.write')));

create policy profiles_self_read on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_platform_staff()));

create policy profiles_self_update on public.profiles
  for update to authenticated
  using      (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Состав команды виден участникам арендатора; менять — только с team.write.
create policy tenant_members_read on public.tenant_members
  for select to authenticated
  using (tenant_id in (select public.my_tenants()) or (select public.is_platform_staff()));

create policy tenant_members_write on public.tenant_members
  for all to authenticated
  using      (tenant_id in (select public.tenants_with('team.write')))
  with check (tenant_id in (select public.tenants_with('team.write')));

create policy role_grants_read on public.role_grants
  for select to authenticated using (true);
