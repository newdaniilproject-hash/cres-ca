-- 0110. Модуль перестаёт быть значением ENUM и становится СТРОКОЙ РЕЕСТРА.
--
-- ── Зачем ───────────────────────────────────────────────────────────────────
--
-- Принцип продукта (CLAUDE.md, «Живая среда»): функция подключается ДАННЫМИ,
-- а не выкатом. Сегодня это не так. Чтобы завести новый модуль, надо было
-- тронуть ВОСЕМЬ мест, и три из них требовали выката кода одновременно
-- с миграцией:
--
--   1. `alter type tenant_module add value` — миграция;
--   2. тип `TenantModule` в `lib/tenant.ts` — код;
--   3. `MODULE_LABELS` там же — код, и подпись захардкожена по-украински
--      мимо словаря;
--   4. `DEFAULT_MODULES` там же — КОПИЯ умолчания из миграции;
--   5–6. `TABS` / `MENU` и `HEADINGS` в оболочке — код;
--   7. строки в `uk.json`;
--   8. сам экран.
--
-- Пункты 1, 3 и 4 закрывает эта миграция: список модулей, их подписи,
-- значки, порядок и принадлежность к умолчанию переезжают в таблицу.
--
-- ── Что НЕ меняется ─────────────────────────────────────────────────────────
--
-- Формат токена. Хук кладёт модули как массив строк (`to_jsonb(t.modules)`),
-- и для `text[]` он ровно тот же, что был для `tenant_module[]`. Значит
-- развёрнутое приложение продолжает работать с этой миграцией без выката —
-- правило «миграции добавляющие, сужающая идёт после выката» соблюдено.
--
-- Тип `public.tenant_module` НЕ удаляется: он остаётся в сигнатурах старых
-- функций и в истории. Источником правды он быть перестаёт, и это главное.
--
-- Проверено перед написанием: `tenant_has_module` не вызывается НИ ОДНОЙ
-- политикой RLS (запрос к `pg_policies` на боевой базе вернул ноль). Поэтому
-- смена типа второго параметра с enum на text не может сломать доступ.

-- ── 1. Реестр ───────────────────────────────────────────────────────────────
--
-- Одна строка — один модуль продукта. Подпись здесь, а не в словаре
-- интерфейса, по тому же правилу, по которому в словаре нет названий
-- специальностей: это СПРАВОЧНИК, и переводится он данными (CLAUDE.md,
-- «Локализация — как делать»). Заводя модуль, вы заводите строку.
create table if not exists public.modules (
  code        text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  title       text not null check (length(btrim(title)) > 0),
  description text,
  -- Имя значка из `components/icons.tsx`. Строкой, а не ссылкой на файл:
  -- значки живут в коде и там же проверяются типом.
  icon        text,
  -- Адрес раздела в кабинете. Он здесь затем, чтобы НАВИГАЦИЯ строилась
  -- из реестра: без маршрута список пунктов остался бы массивом в коде,
  -- и добавление модуля по-прежнему требовало бы правки оболочки.
  route       text,
  -- Право, без которого раздел не показывается человеку. Вторая ось
  -- доступа (первая — сам факт наличия модуля у заведения). Держать её
  -- здесь правильно: это свойство РАЗДЕЛА, а не конкретного заведения.
  perm        text,
  -- Место в нижней панели телефона. Больше четырёх туда не помещается
  -- так, чтобы подпись читалась и зона нажатия осталась 44px, — поэтому
  -- признак, а не порядок: панель берёт первые четыре по `position`.
  in_tabs     boolean not null default false,
  -- Порядок в навигации. Шаг 10, чтобы вставить между двумя соседями
  -- можно было без переномерации всего списка.
  position    int  not null default 100,
  -- Входит ли в набор нового заведения. ⚠️ Умолчание колонки
  -- `tenants.modules` СНЯТО ниже именно поэтому: держать список и здесь,
  -- и в `default` колонки значит завести ту самую вторую копию, ради
  -- устранения которой всё это и делается.
  is_default  boolean not null default false,
  -- Модуль существует в продукте. Выключенный не выдаётся никому и не
  -- проходит сторожа — так снимается функция, не удаляя историю тех,
  -- у кого она была (правило 8: выключено значит удалено, но здесь
  -- удалять строку нельзя — на неё ссылаются заведения).
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.modules is
  'Реестр модулей продукта. Источник правды о том, какие модули существуют, '
  'как называются и что входит в набор нового заведения.';

-- Порядок и состав повторяют то, что было массивами `TABS` и `MENU`
-- в `components/app-shell.tsx`. Панель телефона — четыре первых
-- с `in_tabs`; «Профіль» в панели тоже есть, но модулем не является
-- (личный кабинет человека не покупается) и остаётся в коде.
--
-- «Записи» стоят на `orders.read`, а не на своём праве: отдельного
-- `bookings.*` в базе нет — политики 0010 стоят на `orders.read`.
insert into public.modules
  (code, title, description, icon, route, perm, position, in_tabs, is_default) values
  ('inventory',  'Склад',      'Розхідники, ємності, приймання, інвентаризація',
     'IconBox',      '/app/inventory',  'stock.read',      10, true,  true),
  ('bookings',   'Записи',     'Запис на послуги, слоти, нагадування',
     'IconCalendar', '/app/bookings',   'orders.read',     20, true,  true),
  ('catalog',    'Послуги',    'Товари і послуги',
     'IconScissors', '/app/catalog',    'catalog.read',    30, true,  true),
  ('compliance', 'Журнали',    'Санітарні журнали, документи, техкарти, звіт для перевірки',
     'IconCheck',    '/app/journals',   'compliance.read', 40, false, true),
  ('orders',     'Замовлення', 'Замовлення і доставка',
     'IconBag',      '/app/orders',     'orders.read',     50, false, true),
  ('customers',  'Клієнти',    'База клієнтів і нагадування',
     'IconUsers',    '/app/customers',  'customers.read',  60, false, true),
  ('finance',    'Фінанси',    'Доходи, витрати, собівартість',
     'IconMoney',    '/app/finance',    'finances.read',   70, false, false),
  ('storefront', 'Вітрина',    'Публічна сторінка і загальний пошук',
     'IconGear',     null,              null,              80, false, true),
  ('marketing',  'Маркетинг',  'Розсилки, промокоди, реферальні посилання',
     'IconGear',     null,              null,              90, false, false)
on conflict (code) do nothing;

-- Реестр читают ВСЕ вошедшие: по нему собирается навигация. Он не содержит
-- ничего про конкретное заведение — только список модулей продукта.
alter table public.modules enable row level security;

drop policy if exists modules_read on public.modules;
create policy modules_read on public.modules
  for select to authenticated
  using (true);

-- ⚠️ `using (true)` здесь допустимо и это ИСКЛЮЧЕНИЕ, которое надо назвать
-- (CLAUDE.md, правило 7: «using(true) — ошибка приёмки»). Правило требует
-- фильтра по арендатору там, где у строки есть арендатор. У строки реестра
-- его нет и быть не может: «Склад» — это модуль ПРОДУКТА, один на всех,
-- как список валют. Тот же случай, что у четырёх общих справочников,
-- уже названных в `06_isolation.sql`.
--
-- Писать в реестр из кабинета нельзя никому: политик INSERT/UPDATE/DELETE
-- нет вовсе, модуль заводится миграцией или служебной ролью.

-- ── 2. Колонка арендатора переезжает на text[] ──────────────────────────────
--
-- Значения те же строки, что были: `enum::text` даёт ровно код.
alter table public.tenants
  alter column modules drop default;

alter table public.tenants
  alter column modules type text[] using modules::text[];

-- Умолчание колонки НЕ возвращаем: набор нового заведения теперь считается
-- из реестра (`is_default`), и держать его вторым списком в `default`
-- значит воспроизвести ровно ту ошибку, из-за которой `DEFAULT_MODULES`
-- в коде разъезжался с миграцией. Пустой массив как умолчание тоже
-- не годится — заведение без модулей не видит ничего, — поэтому набор
-- проставляет триггер ниже.
alter table public.tenants
  alter column modules set default '{}'::text[];

comment on column public.tenants.modules is
  'Что арендатор купил и видит. Коды из public.modules; набор нового '
  'заведения берётся оттуда же по is_default.';

-- ── 3. Набор по умолчанию — из реестра, а не из копии списка ────────────────
create or replace function public.tenants_default_modules()
returns trigger language plpgsql set search_path to '' as $fn$
begin
  -- Только когда набор не задан явно. Регистрация, задающая свой список,
  -- продолжает работать как работала.
  if new.modules is null or array_length(new.modules, 1) is null then
    select coalesce(array_agg(m.code order by m.position), '{}'::text[])
      into new.modules
      from public.modules m
     where m.is_default and m.is_active;
  end if;
  return new;
end $fn$;

drop trigger if exists tenants_default_modules on public.tenants;
create trigger tenants_default_modules
  before insert on public.tenants
  for each row execute function public.tenants_default_modules();

-- ── 4. Сторож: в наборе не бывает несуществующего модуля ────────────────────
--
-- Раньше эту роль играл сам тип: значение вне enum не вставлялось. Сняв
-- enum, мы обязаны заменить его проверкой — иначе опечатка `invetory`
-- тихо ляжет в базу и раздел просто не появится, а искать это будут
-- в правах и в навигации.
create or replace function public.tenants_modules_guard()
returns trigger language plpgsql set search_path to '' as $fn$
declare v_bad text;
begin
  select m into v_bad
    from unnest(coalesce(new.modules, '{}'::text[])) as m
   where not exists (
     select 1 from public.modules r where r.code = m and r.is_active
   )
   limit 1;

  if v_bad is not null then
    raise exception 'невідомий модуль: %', v_bad;
  end if;
  return new;
end $fn$;

drop trigger if exists tenants_modules_guard on public.tenants;
create trigger tenants_modules_guard
  before insert or update of modules on public.tenants
  for each row execute function public.tenants_modules_guard();

-- ── 5. Проверка модуля — по строке ──────────────────────────────────────────
--
-- Прежняя функция принимала enum. Оставлять ОБЕ нельзя: вызов с литералом
-- (`tenant_has_module(id, 'inventory')`) стал бы неоднозначным — Postgres
-- не смог бы выбрать между text и tenant_module и упал бы на разборе
-- политики. Поэтому старая снимается, новая принимает text.
drop function if exists public.tenant_has_module(uuid, public.tenant_module);

create or replace function public.tenant_has_module(
  p_tenant_id uuid,
  p_module    text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select p_module = any(
       select jsonb_array_elements_text(
         coalesce(
           (current_setting('request.jwt.claims', true)::jsonb
             -> 'app_metadata' -> 'modules' -> p_tenant_id::text),
           '[]'::jsonb)))),
    false);
$$;

revoke execute on function public.tenant_has_module(uuid, text) from public;
revoke execute on function public.tenant_has_module(uuid, text) from anon;
revoke execute on function public.tenant_has_module(uuid, text) from authenticated;
-- Исключение по правилу 7 — то же, что у `tenant_can`: хелпер разбирает
-- только токен и ни к одной таблице не обращается. Возвращаем право
-- выполнения обеим ролям осознанно и по тому же признаку.
grant execute on function public.tenant_has_module(uuid, text) to anon, authenticated;

revoke execute on function public.tenants_default_modules() from public;
revoke execute on function public.tenants_default_modules() from anon;
revoke execute on function public.tenants_default_modules() from authenticated;
grant  execute on function public.tenants_default_modules() to service_role;

revoke execute on function public.tenants_modules_guard() from public;
revoke execute on function public.tenants_modules_guard() from anon;
revoke execute on function public.tenants_modules_guard() from authenticated;
grant  execute on function public.tenants_modules_guard() to service_role;

-- Реестр читают все вошедшие и только читают.
revoke all on public.modules from public;
revoke all on public.modules from anon;
revoke all on public.modules from authenticated;
grant select on public.modules to authenticated;
grant select on public.modules to service_role;
