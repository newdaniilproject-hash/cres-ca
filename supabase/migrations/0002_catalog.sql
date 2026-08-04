-- 0002_catalog.sql
-- Каталог: товары и услуги в одной модели.
--
-- Требование: платформа должна одинаково хорошо ложиться на пальто, на маникюр,
-- на ремонт техники и на что угодно ещё. Поэтому характеристики позиции —
-- это ДАННЫЕ, а не колонки. В прошлом проекте были таблицы model_sizes и model_colors,
-- то есть схема знала, что торгует одеждой; повторять это нельзя.
--
-- Устройство:
--   categories          — дерево категорий маркетплейса, общее для всех
--   category_attributes — какие поля есть у позиции в этой категории
--   offerings           — сама позиция (товар ИЛИ услуга)
--   offering_variants   — то, что реально покупают: размер, тариф, длительность
--   offering_media      — фото и видео
--
-- Остатки живут на варианте и только у товаров. У услуги вместо остатка —
-- ёмкость расписания (см. 0004_services.sql).

-- ─────────────────────────────────────────────────────────────────────────────
-- Типы
-- ─────────────────────────────────────────────────────────────────────────────

create type public.offering_kind   as enum ('product', 'service');
create type public.offering_status as enum ('draft', 'active', 'hidden', 'archived');

-- Тип поля характеристики. Определяет и контрол в админке, и вид фильтра
-- на витрине. Новый тип добавляется здесь, а не в коде каждой формы.
create type public.attribute_type as enum (
  'text',      -- свободная строка
  'number',    -- число (с единицей измерения)
  'boolean',   -- да/нет
  'select',    -- один из списка
  'multi',     -- несколько из списка
  'color',     -- цвет (значение + hex для свотча)
  'date',
  'range'      -- диапазон: температура, возраст, вес
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Категории маркетплейса
-- ─────────────────────────────────────────────────────────────────────────────
-- Общие для всей платформы: именно они делают возможным сквозной поиск
-- по всем магазинам. Продавец выбирает категорию, а не придумывает свою.
-- Свои произвольные группировки продавец делает коллекциями (ниже).

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.categories(id) on delete restrict,
  slug        citext not null unique,
  name        text   not null,
  kind        public.offering_kind not null,
  icon        text,
  position    int    not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index categories_parent_idx on public.categories (parent_id, position);
create index categories_kind_idx   on public.categories (kind) where is_active;

-- Схема характеристик категории. Наследуется вниз по дереву:
-- «Одежда» задаёт размер и цвет, «Пальто» добавляет утеплитель.
create table public.category_attributes (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.categories(id) on delete cascade,
  key          citext not null,
  label        text   not null,
  type         public.attribute_type not null,
  unit         text,
  options      jsonb  not null default '[]'::jsonb,

  is_required  boolean not null default false,
  -- Участвует в фильтрах витрины и общего каталога
  is_filter    boolean not null default false,
  -- Определяет вариант покупки (размер — да, состав ткани — нет)
  is_variant   boolean not null default false,
  position     int not null default 0,

  unique (category_id, key)
);

create index category_attributes_cat_idx on public.category_attributes (category_id, position);

-- ─────────────────────────────────────────────────────────────────────────────
-- Позиции
-- ─────────────────────────────────────────────────────────────────────────────

create table public.offerings (
  id           uuid not null default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,

  kind         public.offering_kind   not null,
  status       public.offering_status not null default 'draft',

  category_id  uuid references public.categories(id) on delete restrict,

  -- Артикул и адрес уникальны В ПРЕДЕЛАХ АРЕНДАТОРА.
  -- Глобальная уникальность sku и slug — та самая мина, которая
  -- взорвалась бы в день прихода второго продавца.
  sku          citext,
  slug         citext not null check (slug ~ '^[a-z0-9][a-z0-9-]*$'),

  title        text not null check (length(btrim(title)) > 0),
  subtitle     text,
  description  text,

  -- Цена-витрина. Реальная цена покупки берётся с варианта,
  -- здесь — то, что показывается в карточке каталога («от N»).
  price        numeric(12, 2) check (price >= 0),
  compare_at   numeric(12, 2) check (compare_at >= 0),
  currency     char(3) not null default 'UAH',

  -- Характеристики по схеме категории: {"material": "шерсть", "warmth": 3}
  attributes   jsonb not null default '{}'::jsonb,

  -- Произвольные метки продавца для внутренней работы
  tags         text[] not null default '{}',

  -- Показывать в общем каталоге маркетплейса.
  -- Итог = tenants.listed_in_catalog AND offerings.listed
  listed       boolean not null default true,

  rating_avg   numeric(3, 2) not null default 0,
  rating_count int not null default 0,

  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  primary key (id),
  unique (tenant_id, slug),
  unique (tenant_id, sku)
);

create index offerings_tenant_idx   on public.offerings (tenant_id, status);
create index offerings_category_idx on public.offerings (category_id)
  where status = 'active' and listed;
create index offerings_attrs_idx    on public.offerings using gin (attributes jsonb_path_ops);
create index offerings_tags_idx     on public.offerings using gin (tags);

create trigger offerings_touch
  before update on public.offerings
  for each row execute function public.touch_updated_at();

-- Вариант — это то, что кладут в корзину.
-- Товар: «M / чёрный». Услуга: «Классический маникюр, 60 мин».
-- У позиции всегда есть минимум один вариант, даже если он единственный.
create table public.offering_variants (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  offering_id  uuid not null references public.offerings(id) on delete cascade,

  name         text not null,
  sku          citext,

  -- Значения вариантообразующих характеристик: {"size": "M", "color": "black"}
  options      jsonb not null default '{}'::jsonb,

  price        numeric(12, 2) check (price >= 0),
  compare_at   numeric(12, 2) check (compare_at >= 0),
  cost         numeric(12, 2) check (cost >= 0),

  -- Остатки. Только для товаров; у услуг всегда 0 и track_stock = false.
  track_stock  boolean not null default true,
  stock_qty    int not null default 0,
  reserved_qty int not null default 0 check (reserved_qty >= 0),

  weight_g     int,
  barcode      citext,
  position     int not null default 0,
  is_active    boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (tenant_id, sku),
  unique (offering_id, name)
);

create index offering_variants_offering_idx on public.offering_variants (offering_id, position);
create index offering_variants_tenant_idx   on public.offering_variants (tenant_id);

create trigger offering_variants_touch
  before update on public.offering_variants
  for each row execute function public.touch_updated_at();

-- Доступно к продаже = остаток минус резерв.
create or replace function public.variant_available(v public.offering_variants)
returns int
language sql
immutable
as $$
  select case when v.track_stock then greatest(v.stock_qty - v.reserved_qty, 0) else 2147483647 end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Медиа
-- ─────────────────────────────────────────────────────────────────────────────
-- Отдельной таблицей, а не массивом URL: нужны порядок, alt-текст,
-- привязка к варианту (фото конкретного цвета) и корректное удаление файлов.

create table public.offering_media (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  offering_id  uuid not null references public.offerings(id) on delete cascade,
  variant_id   uuid references public.offering_variants(id) on delete set null,

  kind         text not null default 'image' check (kind in ('image', 'video')),
  -- Путь в Storage вида <tenant_id>/offerings/<offering_id>/<file>
  path         text not null,
  alt          text,
  width        int,
  height       int,
  position     int not null default 0,

  created_at   timestamptz not null default now()
);

create index offering_media_offering_idx on public.offering_media (offering_id, position);
create index offering_media_tenant_idx   on public.offering_media (tenant_id);
-- Внешний ключ, по которому реально происходит удаление родителя (вариант),
-- обязан быть покрыт индексом — иначе каждое удаление варианта сканирует
-- всю таблицу медиа. Индексы «на всякий случай» при этом не заводим:
-- в прошлом проекте набралось сорок индексов, которыми не воспользовались
-- ни разу, — они замедляют запись и ничего не ускоряют.
create index offering_media_variant_idx  on public.offering_media (variant_id)
  where variant_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Коллекции продавца
-- ─────────────────────────────────────────────────────────────────────────────
-- Собственные подборки для витрины: «Новинки», «Зима», «Хиты».
-- Не путать с категориями маркетплейса — те общие и нужны для поиска.

create table public.collections (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  slug        citext not null,
  name        text not null,
  description text,
  cover_path  text,
  position    int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),

  unique (tenant_id, slug)
);

create table public.collection_items (
  collection_id uuid not null references public.collections(id) on delete cascade,
  offering_id   uuid not null references public.offerings(id) on delete cascade,
  position      int not null default 0,
  primary key (collection_id, offering_id)
);

create index collection_items_offering_idx on public.collection_items (offering_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- Два правила на каждую таблицу: «мир видит опубликованное»
-- и «участник арендатора работает со своим». Никаких глобальных
-- проверок «ты вообще админ» — только «ты кто в ЭТОМ магазине».

alter table public.categories         enable row level security;
alter table public.category_attributes enable row level security;
alter table public.offerings          enable row level security;
alter table public.offering_variants  enable row level security;
alter table public.offering_media     enable row level security;
alter table public.collections        enable row level security;
alter table public.collection_items   enable row level security;

create policy categories_read on public.categories
  for select to anon, authenticated using (is_active);

create policy category_attributes_read on public.category_attributes
  for select to anon, authenticated using (true);

-- Публично: только активная позиция активного опубликованного магазина.
create policy offerings_public_read on public.offerings
  for select to anon, authenticated
  using (
    status = 'active'
    and exists (
      select 1 from public.tenants t
       where t.id = offerings.tenant_id
         and t.status = 'active'
         and t.storefront_enabled
    )
  );

create policy offerings_member_read on public.offerings
  for select to authenticated
  using (tenant_id in (select public.tenants_with('catalog.read')));

create policy offerings_member_write on public.offerings
  for all to authenticated
  using      (tenant_id in (select public.tenants_with('catalog.write')))
  with check (tenant_id in (select public.tenants_with('catalog.write')));

create policy variants_public_read on public.offering_variants
  for select to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from public.offerings o
        join public.tenants t on t.id = o.tenant_id
       where o.id = offering_variants.offering_id
         and o.status = 'active'
         and t.status = 'active'
         and t.storefront_enabled
    )
  );

create policy variants_member_read on public.offering_variants
  for select to authenticated
  using (tenant_id in (select public.tenants_with('catalog.read')));

create policy variants_member_write on public.offering_variants
  for all to authenticated
  using      (tenant_id in (select public.tenants_with('catalog.write')))
  with check (tenant_id in (select public.tenants_with('catalog.write')));

create policy media_public_read on public.offering_media
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.offerings o
        join public.tenants t on t.id = o.tenant_id
       where o.id = offering_media.offering_id
         and o.status = 'active'
         and t.status = 'active'
         and t.storefront_enabled
    )
  );

create policy media_member_write on public.offering_media
  for all to authenticated
  using      (tenant_id in (select public.tenants_with('catalog.write')))
  with check (tenant_id in (select public.tenants_with('catalog.write')));

create policy collections_public_read on public.collections
  for select to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from public.tenants t
       where t.id = collections.tenant_id
         and t.status = 'active'
         and t.storefront_enabled
    )
  );

create policy collections_member_write on public.collections
  for all to authenticated
  using      (tenant_id in (select public.tenants_with('catalog.write')))
  with check (tenant_id in (select public.tenants_with('catalog.write')));

create policy collection_items_read on public.collection_items
  for select to anon, authenticated using (true);

create policy collection_items_write on public.collection_items
  for all to authenticated
  using (
    exists (
      select 1 from public.collections c
       where c.id = collection_items.collection_id
         and c.tenant_id in (select public.tenants_with('catalog.write'))
    )
  )
  with check (
    exists (
      select 1 from public.collections c
       where c.id = collection_items.collection_id
         and c.tenant_id in (select public.tenants_with('catalog.write'))
    )
  );
