-- 0012_integrations.sql
-- Ключи продавцов, Нова Пошта, импорт каталога, задания AI.
--
-- ГЛАВНОЕ РЕШЕНИЕ ФАЙЛА: ключи интеграций продавца НЕ ЛЕЖАТ В ОБЫЧНОЙ
-- ТАБЛИЦЕ. Каждый продавец подключает СВОЮ Нову Пошту, СВОЙ эквайринг,
-- СВОЮ кассу — платформа лишь вызывает их API от его имени (ADR 0005).
-- Значит у нас на руках оказываются чужие боевые ключи, а это худший
-- вид данных: их утечка бьёт не по нам, а по продавцу, и не деньгами,
-- а его отношениями с клиентами.
--
-- Поэтому: сам секрет уходит в Supabase Vault (шифрование на стороне
-- базы), в нашей таблице остаётся только ССЫЛКА на него. Расшифровать
-- может исключительно сервисная роль в фоновой задаче. У продавца нет
-- способа прочитать даже собственный ключ обратно — он может только
-- заменить его. Это осознанное неудобство: возможность «показать ключ»
-- нужна раз в жизни, а утечь может каждый день.
--
-- И каждое использование ключа пишется в журнал. Когда продавец спросит
-- «кто и зачем дёргал мою Нову Пошту» — ответ должен быть, а не «ну,
-- наверное, система».

-- Vault даёт Supabase. В чистом Postgres (наш тестовый прогон) его нет —
-- там подставляется совместимая заглушка из supabase/tests/00_stubs.sql,
-- поэтому расширение подключается только если оно доступно.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'supabase_vault') then
    create extension if not exists supabase_vault with schema vault cascade;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Хранилище ключей
-- ─────────────────────────────────────────────────────────────────────────────

create type public.integration_provider as enum (
  'nova_poshta',   -- доставка: ТТН, трекинг, наложенный платёж
  'ukrposhta',
  'liqpay',        -- эквайринг продавца
  'wayforpay',
  'monobank',
  'checkbox',      -- ПРРО, фискальные чеки
  'vchasno_kasa'
);

create type public.integration_status as enum ('draft', 'active', 'error', 'disabled');

create table public.integrations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  provider    public.integration_provider not null,

  status      public.integration_status not null default 'draft',

  -- Несекретные настройки: город отправки, отделение по умолчанию,
  -- ФИО отправителя, номер кассы. Это можно показывать продавцу.
  settings    jsonb not null default '{}'::jsonb,

  -- Ссылка на секрет в Vault. Сам ключ здесь НЕ ХРАНИТСЯ.
  secret_id   uuid,
  -- Хвост ключа для опознания в интерфейсе: «…f4c2». Не секрет.
  secret_hint text,

  last_ok_at  timestamptz,
  last_error  text,

  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (tenant_id, provider)
);

create index integrations_tenant_idx on public.integrations (tenant_id);
create index integrations_created_by_idx on public.integrations (created_by) where created_by is not null;

create trigger integrations_touch
  before update on public.integrations
  for each row execute function public.touch_updated_at();

-- Секрет и ссылку на него нельзя подменить обычным UPDATE: иначе
-- продавец (или взломанная сессия) подцепил бы чужой секрет по id.
create or replace function public.integrations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('vitrina.allow_secret_write', true), '') <> 'on'
     and new.secret_id is distinct from old.secret_id then
    raise exception 'ключ меняется только через set_integration_secret()';
  end if;
  return new;
end;
$$;

create trigger integrations_guard
  before update on public.integrations
  for each row execute function public.integrations_guard();

revoke execute on function public.integrations_guard() from public, anon, authenticated;

-- Журнал обращений к ключу. Пишется тем, кто ключ забирает.
create table public.integration_access_log (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  purpose        text not null,          -- 'create_ttn', 'track', 'refund'
  ref_type       text,
  ref_id         uuid,
  succeeded      boolean,
  created_at     timestamptz not null default now()
);

create index integration_access_log_idx on public.integration_access_log (integration_id, created_at desc);
create index integration_access_log_tenant_idx on public.integration_access_log (tenant_id, created_at desc);

-- Запись ключа. Продавец вызывает с правом settings.write; ключ уходит
-- в Vault и обратно не читается.
create or replace function public.set_integration_secret(
  p_tenant_id uuid,
  p_provider  public.integration_provider,
  p_secret    text,
  p_settings  jsonb default '{}'::jsonb
)
returns public.integrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       public.integrations;
  v_secret_id uuid;
  v_old       uuid;
begin
  if not public.tenant_can(p_tenant_id, 'settings.write') then
    raise exception 'недостаточно прав: settings.write';
  end if;
  if p_secret is null or length(btrim(p_secret)) < 8 then
    raise exception 'ключ слишком короткий — похоже, вставилось не то';
  end if;

  select secret_id into v_old from public.integrations
   where tenant_id = p_tenant_id and provider = p_provider;

  v_secret_id := vault.create_secret(
    btrim(p_secret),
    format('%s:%s:%s', p_tenant_id, p_provider, extract(epoch from clock_timestamp())::bigint),
    format('Ключ %s продавца %s', p_provider, p_tenant_id));

  perform set_config('vitrina.allow_secret_write', 'on', true);

  insert into public.integrations (tenant_id, provider, secret_id, secret_hint, settings, status, created_by)
  values (p_tenant_id, p_provider, v_secret_id,
          '…' || right(btrim(p_secret), 4), p_settings, 'active', auth.uid())
  on conflict (tenant_id, provider) do update
     set secret_id = excluded.secret_id,
         secret_hint = excluded.secret_hint,
         settings = excluded.settings,
         status = 'active',
         last_error = null
  returning * into v_row;

  -- Старый ключ уничтожаем: хранить прошлые ключи незачем.
  if v_old is not null then
    delete from vault.secrets where id = v_old;
  end if;

  return v_row;
end;
$$;

revoke execute on function public.set_integration_secret(uuid, public.integration_provider, text, jsonb)
  from public, anon;
grant execute on function public.set_integration_secret(uuid, public.integration_provider, text, jsonb)
  to authenticated;

-- Чтение ключа. НЕ security definer: работает только под сервисной ролью
-- в фоновой задаче. Из браузера вызвать невозможно в принципе.
create or replace function public.get_integration_secret(
  p_integration_id uuid,
  p_purpose        text,
  p_ref_type       text default null,
  p_ref_id         uuid default null
)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_row    public.integrations;
  v_secret text;
begin
  select * into v_row from public.integrations where id = p_integration_id;
  if not found then
    raise exception 'интеграция не найдена';
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where id = v_row.secret_id;

  insert into public.integration_access_log
    (tenant_id, integration_id, purpose, ref_type, ref_id, succeeded)
  values (v_row.tenant_id, p_integration_id, p_purpose, p_ref_type, p_ref_id, v_secret is not null);

  return v_secret;
end;
$$;

revoke execute on function public.get_integration_secret(uuid, text, text, uuid)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Отправления: Нова Пошта и остальные
-- ─────────────────────────────────────────────────────────────────────────────

create table public.shipments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  order_id      uuid not null references public.orders(id) on delete cascade,

  provider      public.integration_provider not null default 'nova_poshta',
  ttn           text,                       -- номер накладной
  ttn_ref       text,                       -- внутренний id документа у перевозчика

  -- Наложенный платёж: деньги идут перевозчиком напрямую продавцу,
  -- платформа их не касается (ADR 0005).
  cod_amount    numeric check (cod_amount >= 0),
  cod_paid_at   timestamptz,

  recipient_city   text,
  recipient_branch text,
  recipient_name   text,
  recipient_phone  text,
  weight_kg     numeric check (weight_kg > 0),
  declared_value numeric check (declared_value >= 0),

  status_code   text,
  status_text   text,
  status_at     timestamptz,
  est_delivery  date,
  raw           jsonb,                      -- сырой ответ перевозчика

  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (tenant_id, ttn)
);

create index shipments_order_idx  on public.shipments (order_id);
create index shipments_tenant_idx on public.shipments (tenant_id, created_at desc);
create index shipments_track_idx  on public.shipments (provider, ttn)
  where ttn is not null and status_code is distinct from 'delivered';
create index shipments_created_by_idx on public.shipments (created_by) where created_by is not null;

create trigger shipments_touch
  before update on public.shipments
  for each row execute function public.touch_updated_at();

-- Появилась накладная — она же попадает в заказ и уходит покупателю
-- уведомлением (0011 срабатывает на смену статуса).
create or replace function public.shipments_sync_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ttn is not null and new.ttn is distinct from coalesce(old.ttn, '') then
    perform set_config('vitrina.allow_order_write', 'on', true);
    update public.orders set tracking_number = new.ttn where id = new.order_id;
  end if;
  return new;
end;
$$;

create trigger shipments_sync_order
  after insert or update of ttn on public.shipments
  for each row execute function public.shipments_sync_order();

revoke execute on function public.shipments_sync_order() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Импорт каталога
-- ─────────────────────────────────────────────────────────────────────────────
-- Без импорта не переедет ни один действующий продавец Prom: второй раз
-- каталог руками никто не забьёт. Ошибки копятся ПОСТРОЧНО — файл на
-- тысячу позиций не должен падать целиком из-за одной кривой строки.

create type public.import_kind   as enum ('xlsx', 'csv', 'yml', 'api');
create type public.import_status as enum ('pending', 'running', 'done', 'failed', 'cancelled');

create table public.import_jobs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  kind        public.import_kind not null,
  source_path text,                        -- путь в Storage
  source_url  text,                        -- ссылка на YML-фид
  -- Соответствие колонок файла нашим полям: {"Ціна": "price", ...}
  mapping     jsonb not null default '{}'::jsonb,
  -- Обновлять существующие по артикулу или только добавлять новые.
  update_existing boolean not null default true,

  status      public.import_status not null default 'pending',
  rows_total  int not null default 0,
  rows_ok     int not null default 0,
  rows_failed int not null default 0,

  started_at  timestamptz,
  finished_at timestamptz,

  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);

create index import_jobs_tenant_idx on public.import_jobs (tenant_id, created_at desc);
create index import_jobs_created_by_idx on public.import_jobs (created_by);

create table public.import_errors (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.import_jobs(id) on delete cascade,
  row_number int not null,
  column_name text,
  raw_value  text,
  message    text not null
);

create index import_errors_job_idx on public.import_errors (job_id, row_number);

-- ─────────────────────────────────────────────────────────────────────────────
-- Задания AI
-- ─────────────────────────────────────────────────────────────────────────────
-- Описание товара по фотографии. Отдельной таблицей, а не «дёрнули модель
-- из формы», по трём причинам: генерация долгая, её надо повторять при
-- сбое, и её надо считать — расход на AI это деньги платформы, и он
-- обязан быть виден по каждому продавцу.
--
-- Результат НЕ попадает в карточку сам: он кладётся в suggestion,
-- продавец принимает или правит. Молча переписанное описание товара —
-- это потеря доверия к платформе с первого раза.

create type public.ai_job_kind as enum (
  'offering_description',   -- описание по фото
  'offering_attributes',    -- заполнить характеристики категории
  'offering_translate'      -- перевод карточки
);

create table public.ai_jobs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  kind        public.ai_job_kind not null,

  offering_id uuid references public.offerings(id) on delete cascade,
  input       jsonb not null default '{}'::jsonb,   -- пути к фото, подсказки
  suggestion  jsonb,                                -- что предложила модель
  accepted_at timestamptz,                          -- когда продавец принял

  status      public.import_status not null default 'pending',
  error       text,
  tokens_used int,
  cost        numeric,

  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index ai_jobs_tenant_idx   on public.ai_jobs (tenant_id, created_at desc);
create index ai_jobs_offering_idx on public.ai_jobs (offering_id) where offering_id is not null;
create index ai_jobs_pending_idx  on public.ai_jobs (status) where status = 'pending';
create index ai_jobs_created_by_idx on public.ai_jobs (created_by);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- Ключевая тонкость: политика на integrations разрешает ЧИТАТЬ СТРОКУ,
-- но сам ключ в ней не лежит — только ссылка на Vault и хвост из четырёх
-- символов. Прочитать секрет через API нельзя никак.

alter table public.integrations          enable row level security;
alter table public.integration_access_log enable row level security;
alter table public.shipments             enable row level security;
alter table public.import_jobs           enable row level security;
alter table public.import_errors         enable row level security;
alter table public.ai_jobs               enable row level security;

create policy integrations_read on public.integrations
  for select to authenticated
  using (tenant_id in (select public.tenants_with('settings.read')));

create policy integrations_update on public.integrations
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('settings.write')))
  with check (tenant_id in (select public.tenants_with('settings.write')));

create policy integrations_delete on public.integrations
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('settings.write')));

create policy integration_access_log_read on public.integration_access_log
  for select to authenticated
  using (tenant_id in (select public.tenants_with('settings.read')));

create policy shipments_read on public.shipments
  for select to authenticated
  using (
    tenant_id in (select public.tenants_with('orders.read'))
    or exists (select 1 from public.orders o
                where o.id = shipments.order_id
                  and o.buyer_user_id = (select auth.uid()))
  );

create policy shipments_insert on public.shipments
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('orders.write')));

create policy shipments_update on public.shipments
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('orders.write')))
  with check (tenant_id in (select public.tenants_with('orders.write')));

create policy import_jobs_read on public.import_jobs
  for select to authenticated
  using (tenant_id in (select public.tenants_with('catalog.read')));

create policy import_jobs_insert on public.import_jobs
  for insert to authenticated
  with check (
    tenant_id in (select public.tenants_with('catalog.write'))
    and created_by = (select auth.uid())
  );

create policy import_jobs_update on public.import_jobs
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('catalog.write')))
  with check (tenant_id in (select public.tenants_with('catalog.write')));

create policy import_errors_read on public.import_errors
  for select to authenticated
  using (exists (select 1 from public.import_jobs j
                  where j.id = import_errors.job_id
                    and j.tenant_id in (select public.tenants_with('catalog.read'))));

create policy ai_jobs_read on public.ai_jobs
  for select to authenticated
  using (tenant_id in (select public.tenants_with('catalog.read')));

create policy ai_jobs_insert on public.ai_jobs
  for insert to authenticated
  with check (
    tenant_id in (select public.tenants_with('catalog.write'))
    and created_by = (select auth.uid())
  );

create policy ai_jobs_update on public.ai_jobs
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('catalog.write')))
  with check (tenant_id in (select public.tenants_with('catalog.write')));
