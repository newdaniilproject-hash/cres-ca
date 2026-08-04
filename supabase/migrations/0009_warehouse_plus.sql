-- 0009_warehouse_plus.sql
-- Склад до уровня «первая точка контакта».
--
-- Первый платящий клиент открывает склад на телефоне и должен за минуту
-- получить ответы на четыре вопроса, ради которых люди вообще заводят учёт:
--   что заканчивается и что закупить;
--   сколько денег лежит на полках;
--   где физически лежит эта позиция;
--   что это за штрихкод, который я сейчас отсканировал.
-- Схема из 0003 давала журнал и остаток, но ни одного из этих ответов.
--
-- Заодно исправляю ту же ошибку прошлого проекта, которую сам повторил:
-- в 0003 поставщик был СВОБОДНЫМ ТЕКСТОМ (materials.supplier,
-- stock_receipts.supplier). Ровно так в прошлом проекте появлялись
-- «Розетка», «розетка», «Розетка ТОВ» как три разных поставщика.
-- Поставщик становится таблицей со ссылочной целостностью.

-- ─────────────────────────────────────────────────────────────────────────────
-- Поставщики
-- ─────────────────────────────────────────────────────────────────────────────

create table public.suppliers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,

  name       text not null check (length(btrim(name)) > 0),
  phone      text,
  email      citext,
  note       text,
  is_active  boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, name)
);

create index suppliers_tenant_idx on public.suppliers (tenant_id) where is_active;

create trigger suppliers_touch
  before update on public.suppliers
  for each row execute function public.touch_updated_at();

revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- Свободный текст заменяется ссылкой. База пустая, поэтому переносить
-- нечего: «выключено — значит удалено» (CLAUDE.md, правило 8).
alter table public.materials      drop column supplier;
alter table public.stock_receipts drop column supplier;

alter table public.materials
  add column supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.stock_receipts
  add column supplier_id uuid references public.suppliers(id) on delete restrict;

create index materials_supplier_idx      on public.materials (supplier_id)      where supplier_id is not null;
create index stock_receipts_supplier_idx on public.stock_receipts (supplier_id) where supplier_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Места хранения
-- ─────────────────────────────────────────────────────────────────────────────
-- Отвечают на вопрос «где лежит»: полка, стеллаж, комната, машина.
--
-- ГРАНИЦА ЧЕСТНО: это МЕТКА с ссылочной целостностью, а не отдельный
-- баланс на каждое место. Остаток по-прежнему один на вариант. Полноценный
-- помест­ный учёт (перемещения между складами с раздельными остатками)
-- — отдельная миграция, когда появится клиент с двумя реальными складами.
-- Строить его сейчас — это половина механизма, которая создаёт ощущение
-- учёта, не давая его. В прошлом проекте так и было: колонка
-- warehouse_location свободным текстом, по которой ничего не сходилось.

create table public.storage_locations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  note       text,
  position   int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),

  unique (tenant_id, name)
);

create index storage_locations_tenant_idx on public.storage_locations (tenant_id) where is_active;

alter table public.offering_variants
  add column location_id uuid references public.storage_locations(id) on delete set null;
alter table public.materials
  add column location_id uuid references public.storage_locations(id) on delete set null;

create index offering_variants_location_idx on public.offering_variants (location_id) where location_id is not null;
create index materials_location_idx         on public.materials (location_id)         where location_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Порог остатка: «что заканчивается»
-- ─────────────────────────────────────────────────────────────────────────────
-- У расходников порог был с 0003, у товаров — не было. Это перекос:
-- продавец теряет продажи именно на товарах.

alter table public.offering_variants
  add column min_stock_threshold int not null default 0 check (min_stock_threshold >= 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- Единицы измерения товара
-- ─────────────────────────────────────────────────────────────────────────────
-- У расходников единица была, у товаров нет — а торгуют не только штуками:
-- ткань метрами, кофе граммами, песок мешками.

alter table public.offering_variants
  add column unit text not null default 'шт';

-- ─────────────────────────────────────────────────────────────────────────────
-- Сканер: что это за код
-- ─────────────────────────────────────────────────────────────────────────────
-- Один вызов на любой отсканированный код: находит и товар, и расходник,
-- отдаёт сразу то, что нужно показать на экране сканера. Без него
-- приложению пришлось бы делать два запроса и гадать, что нашлось.
--
-- Ищет по штрихкоду, по артикулу варианта и по артикулу позиции —
-- человек сканирует что угодно, включая свою же наклейку с артикулом.

create table public.material_barcodes (
  material_id uuid not null references public.materials(id) on delete cascade,
  barcode     citext not null,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  primary key (material_id, barcode),
  unique (tenant_id, barcode)
);

create index material_barcodes_tenant_idx on public.material_barcodes (tenant_id, barcode);

create or replace function public.scan_lookup(p_tenant_id uuid, p_code citext)
returns table (
  kind        text,        -- 'variant' | 'material'
  id          uuid,
  title       text,
  subtitle    text,
  unit        text,
  stock_qty   numeric,
  available   numeric,
  location    text,
  low_stock   boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'variant',
         v.id,
         o.title,
         v.name,
         v.unit,
         v.stock_qty::numeric,
         greatest(v.stock_qty - v.reserved_qty, 0)::numeric,
         l.name,
         v.track_stock and v.stock_qty <= v.min_stock_threshold
    from public.offering_variants v
    join public.offerings o on o.id = v.offering_id
    left join public.storage_locations l on l.id = v.location_id
   where v.tenant_id = p_tenant_id
     and public.tenant_can(p_tenant_id, 'stock.read')
     and (v.barcode = p_code or v.sku = p_code or o.sku = p_code)

  union all

  select 'material',
         m.id,
         m.name,
         m.category,
         m.unit,
         m.current_stock,
         m.current_stock,
         l.name,
         m.current_stock <= m.min_stock_threshold
    from public.materials m
    left join public.storage_locations l on l.id = m.location_id
   where m.tenant_id = p_tenant_id
     and public.tenant_can(p_tenant_id, 'stock.read')
     and exists (select 1 from public.material_barcodes b
                  where b.material_id = m.id and b.barcode = p_code)
  limit 10;
$$;

revoke execute on function public.scan_lookup(uuid, citext) from public, anon;
grant  execute on function public.scan_lookup(uuid, citext) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Сводки склада
-- ─────────────────────────────────────────────────────────────────────────────
-- Представления с security_invoker: RLS применяется к тому, кто смотрит,
-- а не к тому, кто создал представление. Без этого флага представление
-- стало бы дырой в обход политик — ровно тем «обходом», который запрещён
-- правилом 3.

-- «Что закупить»: всё, что на пороге или ниже, товары и расходники вместе.
create view public.stock_low_view
with (security_invoker = true) as
  select v.tenant_id,
         'variant'::text as kind,
         v.id                        as id,
         o.title || ' · ' || v.name  as title,
         v.unit                      as unit,
         v.stock_qty::numeric        as stock_qty,
         v.min_stock_threshold::numeric as threshold,
         (v.min_stock_threshold - v.stock_qty)::numeric as to_order,
         null::text                  as supplier
    from public.offering_variants v
    join public.offerings o on o.id = v.offering_id
   where v.track_stock and v.is_active
     and v.min_stock_threshold > 0
     and v.stock_qty <= v.min_stock_threshold

  union all

  select m.tenant_id,
         'material',
         m.id,
         m.name,
         m.unit,
         m.current_stock,
         m.min_stock_threshold,
         m.min_stock_threshold - m.current_stock,
         s.name
    from public.materials m
    left join public.suppliers s on s.id = m.supplier_id
   where m.is_active
     and m.min_stock_threshold > 0
     and m.current_stock <= m.min_stock_threshold;

-- «Сколько денег на полках»: по себестоимости и по цене продажи.
create view public.stock_value_view
with (security_invoker = true) as
  select v.tenant_id,
         sum(v.stock_qty)                                   as units,
         sum(v.stock_qty * coalesce(v.cost, 0))             as cost_value,
         sum(v.stock_qty * coalesce(v.price, 0))            as retail_value,
         count(*) filter (where v.stock_qty <= 0)           as out_of_stock,
         count(*) filter (where v.min_stock_threshold > 0
                            and v.stock_qty <= v.min_stock_threshold) as low_stock
    from public.offering_variants v
   where v.track_stock and v.is_active
   group by v.tenant_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.suppliers         enable row level security;
alter table public.storage_locations enable row level security;
alter table public.material_barcodes enable row level security;

create policy suppliers_read on public.suppliers
  for select to authenticated
  using (tenant_id in (select public.tenants_with('stock.read')));

create policy suppliers_insert on public.suppliers
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('stock.write')));

create policy suppliers_update on public.suppliers
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('stock.write')))
  with check (tenant_id in (select public.tenants_with('stock.write')));

create policy suppliers_delete on public.suppliers
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('stock.write')));

create policy storage_locations_read on public.storage_locations
  for select to authenticated
  using (tenant_id in (select public.tenants_with('stock.read')));

create policy storage_locations_insert on public.storage_locations
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('stock.write')));

create policy storage_locations_update on public.storage_locations
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('stock.write')))
  with check (tenant_id in (select public.tenants_with('stock.write')));

create policy storage_locations_delete on public.storage_locations
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('stock.write')));

create policy material_barcodes_read on public.material_barcodes
  for select to authenticated
  using (tenant_id in (select public.tenants_with('stock.read')));

create policy material_barcodes_insert on public.material_barcodes
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('stock.write')));

create policy material_barcodes_delete on public.material_barcodes
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('stock.write')));
