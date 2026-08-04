-- 0003_inventory.sql
-- Склад: остатки товаров, расходники, приёмки, инвентаризация, резерв под заказ.
--
-- Это не абстрактное упражнение — это прямой ответ на разбор боевой базы
-- прошлого проекта. Там факт «сколько единицы в наличии» хранился НЕЗАВИСИМО
-- в четырёх местах одновременно: агрегатные счётчики на размере, jsonb-остаток
-- на цвете, флаг «нет в наличии» на модели и реальные единицы товара —
-- и ни одно из мест не выводилось из другого. Журнал движений (stock_movements)
-- существовал, но в него почти не писали: 2 строки движений на 1559 единиц
-- товара. То есть «источник правды» был декоративным, а реальные остатки
-- правились где попало, напрямую. Отсюда и растут «пропала строка»,
-- «продали то, чего не было», «расходник не списался».
--
-- Здесь это устройство запрещено физически, на уровне базы:
--
--   1. Остаток (offering_variants.stock_qty, materials.current_stock) —
--      это КЭШ, а не источник правды. Источник правды — таблица
--      stock_movements, добавляется только через неё.
--   2. Приложению нельзя обновить кэш напрямую — это блокирует триггер-охранник
--      (guard_stock_columns). Единственный путь — функции ниже, которые
--      в одной транзакции пишут строку движения И двигают кэш. Расхождения
--      между «журналом» и «остатком» становятся невозможны, а не «маловероятны».
--   3. Резерв остатка — обычный остаток минус активные резервы, тоже кэш,
--      тоже под тем же триггером-охранником.
--   4. Знак количества в движении обязан соответствовать типу движения —
--      проверяется CHECK'ом, а не соглашением в коде.
--   5. Приёмка и инвентаризация — документы: черновик → применение одной
--      функцией одной транзакцией. Применённый документ неизменяем: не «отредактировали
--      задним числом», а новое корректирующее движение.
--
-- Расходники (нитки, гель, крем — «за что списывается материал») — та же
-- модель, тот же журнал: одна таблица stock_movements обслуживает и то,
-- и то, различаясь только тем, какой из двух FK заполнен.

-- ─────────────────────────────────────────────────────────────────────────────
-- Типы
-- ─────────────────────────────────────────────────────────────────────────────

create type public.stock_movement_type as enum (
  'receipt',       -- поступление (приёмка от поставщика/производства)
  'sale',          -- продажа (списание проданной единицы товара)
  'write_off',     -- списание (брак, порча, расход материала на заказ)
  'return',        -- возврат на склад
  'adjustment',    -- корректировка по итогам инвентаризации
  'transfer_out',  -- перемещение со склада
  'transfer_in'    -- перемещение на склад
);

create type public.stock_reservation_status as enum
  ('active', 'committed', 'released', 'expired');

create type public.stock_receipt_status as enum
  ('draft', 'applied', 'cancelled');

create type public.stock_count_status as enum
  ('counting', 'applied', 'cancelled');

-- ─────────────────────────────────────────────────────────────────────────────
-- Жёсткие инварианты остатка товара, которых не было в 0002.
-- Остаток не может быть отрицательным, резерв не может превышать остаток —
-- проверяется базой при КАЖДОМ изменении, а не надеждой на дисциплину кода.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.offering_variants
  add constraint offering_variants_stock_nonneg    check (stock_qty >= 0),
  add constraint offering_variants_reserved_le_stock check (reserved_qty <= stock_qty);

-- ─────────────────────────────────────────────────────────────────────────────
-- Расходники
-- ─────────────────────────────────────────────────────────────────────────────
-- То, что продавец расходует, но не продаёт напрямую: ткань, нитки, гель для
-- маникюра, масло для массажа. Модель материала не знает, что именно
-- он расходует — так же, как categories/attributes не знают, что торгуют
-- одеждой.

create table public.materials (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,

  name               text not null check (length(btrim(name)) > 0),
  unit               text not null,          -- «г», «мл», «шт», «м» — свой словарь продавца
  category           text,

  current_stock      numeric not null default 0 check (current_stock >= 0),
  min_stock_threshold numeric not null default 0 check (min_stock_threshold >= 0),
  cost_per_unit      numeric check (cost_per_unit >= 0),
  supplier           text,

  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (tenant_id, name)
);

create index materials_tenant_idx on public.materials (tenant_id) where is_active;

create trigger materials_touch
  before update on public.materials
  for each row execute function public.touch_updated_at();

-- Рецепт расхода: сколько материала уходит на одну единицу варианта.
-- «Чёрное платье M» расходует 1.2 м ткани и 3 катушки ниток — две строки.
create table public.variant_materials (
  variant_id        uuid not null references public.offering_variants(id) on delete cascade,
  material_id       uuid not null references public.materials(id) on delete restrict,
  quantity_per_unit numeric not null check (quantity_per_unit > 0),
  created_at        timestamptz not null default now(),

  primary key (variant_id, material_id)
);

-- Первичный ключ покрывает variant_id, но не material_id: без этого индекса
-- любая попытка удалить расходник сканирует все рецепты целиком.
create index variant_materials_material_idx on public.variant_materials (material_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Журнал движений — единственный источник правды
-- ─────────────────────────────────────────────────────────────────────────────

create table public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,

  -- Ровно один: движение либо по товару, либо по расходнику, никогда по обоим.
  variant_id      uuid references public.offering_variants(id) on delete restrict,
  material_id     uuid references public.materials(id) on delete restrict,

  movement_type   public.stock_movement_type not null,
  quantity        numeric not null check (quantity <> 0),

  -- Откуда взялось движение: документ-приёмка, документ-инвентаризация,
  -- заказ, ручная правка. Полиморфная ссылка, потому что источников много
  -- и они появляются в разное время (заказов в схеме пока нет — появятся
  -- отдельной миграцией, движение на них уже готово ссылаться).
  reference_type  text,
  reference_id    uuid,
  receipt_id      uuid,
  count_id        uuid,

  note            text,
  -- Ключ идемпотентности: повторный вызов с тем же ключом (повтор запроса,
  -- ретрай вебхука) не создаёт второе движение и не двигает остаток дважды.
  idempotency_key text,

  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),

  check ((variant_id is not null)::int + (material_id is not null)::int = 1),

  -- Знак обязан совпадать со смыслом движения. Это то, чего не было
  -- в прошлом проекте вообще ни для одной таблицы движений.
  check (
    case movement_type
      when 'receipt'      then quantity > 0
      when 'return'        then quantity > 0
      when 'transfer_in'   then quantity > 0
      when 'sale'          then quantity < 0
      when 'write_off'     then quantity < 0
      when 'transfer_out'  then quantity < 0
      when 'adjustment'    then true  -- корректировка может пойти в любую сторону
    end
  )
);

create index stock_movements_variant_idx  on public.stock_movements (variant_id, created_at desc)
  where variant_id is not null;
create index stock_movements_material_idx on public.stock_movements (material_id, created_at desc)
  where material_id is not null;
create index stock_movements_tenant_idx   on public.stock_movements (tenant_id, created_at desc);
create unique index stock_movements_idempotency_idx
  on public.stock_movements (tenant_id, idempotency_key)
  where idempotency_key is not null;

comment on table public.stock_movements is
  'Источник правды по остаткам. offering_variants.stock_qty и materials.current_stock — '
  'производный кэш, обновляется только функцией record_stock_movement. Строка никогда '
  'не редактируется и не удаляется: ошибочное движение гасится встречным.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Резерв остатка под заказ
-- ─────────────────────────────────────────────────────────────────────────────
-- См. docs/DOMAIN.md: «резервируется в момент оформления, а не оплаты».
-- Отдельная таблица, а не просто reserved_qty на варианте, — потому что
-- нужно знать, ЧТО именно держит резерв и когда он истекает, а не только
-- итоговую цифру.

create table public.stock_reservations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  variant_id      uuid not null references public.offering_variants(id) on delete restrict,

  quantity        int not null check (quantity > 0),
  status          public.stock_reservation_status not null default 'active',

  reference_type  text not null,   -- обычно 'order', заказов в схеме пока нет
  reference_id    uuid not null,
  expires_at      timestamptz,     -- истёк срок ожидания оплаты — резерв снимается

  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now()
);

create index stock_reservations_variant_idx on public.stock_reservations (variant_id)
  where status = 'active';
create index stock_reservations_tenant_idx  on public.stock_reservations (tenant_id, status);
create index stock_reservations_expiry_idx  on public.stock_reservations (expires_at)
  where status = 'active' and expires_at is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Приёмка — документ, не голое движение
-- ─────────────────────────────────────────────────────────────────────────────
-- «Пришла коробка от поставщика с пятью позициями» — один документ,
-- применяется одной транзакцией: либо все пять строк лягут в журнал
-- и в остаток, либо ни одна.

create table public.stock_receipts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,

  supplier        text,
  document_number text,
  status          public.stock_receipt_status not null default 'draft',
  note            text,

  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  applied_by      uuid references public.profiles(id),
  applied_at      timestamptz
);

create index stock_receipts_tenant_idx on public.stock_receipts (tenant_id, status);

create table public.stock_receipt_lines (
  id           uuid primary key default gen_random_uuid(),
  receipt_id   uuid not null references public.stock_receipts(id) on delete cascade,

  variant_id   uuid references public.offering_variants(id) on delete restrict,
  material_id  uuid references public.materials(id) on delete restrict,

  quantity     numeric not null check (quantity > 0),
  unit_cost    numeric check (unit_cost >= 0),
  created_at   timestamptz not null default now(),

  check ((variant_id is not null)::int + (material_id is not null)::int = 1)
);

create index stock_receipt_lines_receipt_idx  on public.stock_receipt_lines (receipt_id);
create index stock_receipt_lines_variant_idx  on public.stock_receipt_lines (variant_id)
  where variant_id is not null;
create index stock_receipt_lines_material_idx on public.stock_receipt_lines (material_id)
  where material_id is not null;

alter table public.stock_movements
  add constraint stock_movements_receipt_fkey foreign key (receipt_id)
    references public.stock_receipts(id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Инвентаризация — тоже документ с моментом отсчёта
-- ─────────────────────────────────────────────────────────────────────────────
-- expected_qty — снимок остатка НА МОМЕНТ НАЧАЛА пересчёта, а не то, что
-- в базе на момент применения (за это время остаток мог измениться другой
-- продажей). Без снимка инвентаризация сравнивает несравнимое.

create table public.stock_counts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  status      public.stock_count_status not null default 'counting',
  note        text,

  started_by  uuid not null references public.profiles(id),
  started_at  timestamptz not null default now(),
  applied_by  uuid references public.profiles(id),
  applied_at  timestamptz
);

create index stock_counts_tenant_idx on public.stock_counts (tenant_id, status);

create table public.stock_count_lines (
  id           uuid primary key default gen_random_uuid(),
  count_id     uuid not null references public.stock_counts(id) on delete cascade,
  variant_id   uuid not null references public.offering_variants(id) on delete restrict,

  expected_qty int not null,      -- снимок на момент start_stock_count
  counted_qty  int,               -- заполняется по ходу пересчёта, null = ещё не досчитали
  created_at   timestamptz not null default now(),

  unique (count_id, variant_id)
);

create index stock_count_lines_count_idx   on public.stock_count_lines (count_id);
create index stock_count_lines_variant_idx on public.stock_count_lines (variant_id);

alter table public.stock_movements
  add constraint stock_movements_count_fkey foreign key (count_id)
    references public.stock_counts(id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Охрана кэша: stock_qty / reserved_qty / current_stock меняются
-- ТОЛЬКО через функции ниже
-- ─────────────────────────────────────────────────────────────────────────────
-- Разработчик, который завтра допишет обновление остатка «в обход», получит
-- ошибку прямо из базы, а не молчаливое расхождение, всплывающее через месяц.

create or replace function public.guard_stock_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('vitrina.allow_stock_write', true), '') = 'on' then
    return new;
  end if;

  if tg_table_name = 'offering_variants' then
    if new.stock_qty is distinct from old.stock_qty
       or new.reserved_qty is distinct from old.reserved_qty then
      raise exception
        'stock_qty/reserved_qty меняются только через record_stock_movement/reserve_stock — не напрямую';
    end if;
  elsif tg_table_name = 'materials' then
    if new.current_stock is distinct from old.current_stock then
      raise exception
        'current_stock меняется только через record_stock_movement — не напрямую';
    end if;
  end if;

  return new;
end;
$$;

create trigger offering_variants_guard_stock
  before update on public.offering_variants
  for each row execute function public.guard_stock_columns();

create trigger materials_guard_stock
  before update on public.materials
  for each row execute function public.guard_stock_columns();

-- Применённый документ неизменяем. Ошибка после применения исправляется
-- новым движением/новой инвентаризацией, а не правкой истории.
create or replace function public.guard_applied_document()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_table_name = 'stock_receipt_lines' then
    select status into v_status from public.stock_receipts
     where id = coalesce(new.receipt_id, old.receipt_id);
  elsif tg_table_name = 'stock_count_lines' then
    select status into v_status from public.stock_counts
     where id = coalesce(new.count_id, old.count_id);
  end if;

  if v_status = 'applied' then
    raise exception 'документ уже применён — правки задним числом запрещены';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger stock_receipt_lines_lock
  before update or delete on public.stock_receipt_lines
  for each row execute function public.guard_applied_document();

create trigger stock_count_lines_lock
  before update or delete on public.stock_count_lines
  for each row execute function public.guard_applied_document();

-- ─────────────────────────────────────────────────────────────────────────────
-- Функции: единственный путь изменить остаток
-- ─────────────────────────────────────────────────────────────────────────────

-- Записывает движение и в той же транзакции двигает кэш остатка.
-- Это и есть гарантия «журнал и остаток никогда не разойдутся»: их обновляет
-- один вызов, а не два разных места кода в разное время.
create or replace function public.record_stock_movement(
  p_tenant_id        uuid,
  p_movement_type    public.stock_movement_type,
  p_quantity         numeric,
  p_variant_id       uuid default null,
  p_material_id      uuid default null,
  p_reference_type   text default null,
  p_reference_id     uuid default null,
  p_receipt_id       uuid default null,
  p_count_id         uuid default null,
  p_note             text default null,
  p_idempotency_key  text default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.stock_movements;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'движение остатка требует авторизованного пользователя';
  end if;

  if not public.tenant_can(p_tenant_id, 'stock.write') then
    raise exception 'недостаточно прав: stock.write в арендаторе %', p_tenant_id;
  end if;

  if (p_variant_id is null) = (p_material_id is null) then
    raise exception 'укажите ровно один из variant_id / material_id';
  end if;

  if p_idempotency_key is not null then
    select * into v_row from public.stock_movements
     where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
    if found then
      return v_row;  -- уже применено этим ключом — не повторяем
    end if;
  end if;

  insert into public.stock_movements
    (tenant_id, variant_id, material_id, movement_type, quantity,
     reference_type, reference_id, receipt_id, count_id, note, idempotency_key, created_by)
  values
    (p_tenant_id, p_variant_id, p_material_id, p_movement_type, p_quantity,
     p_reference_type, p_reference_id, p_receipt_id, p_count_id, p_note, p_idempotency_key, v_actor)
  returning * into v_row;

  perform set_config('vitrina.allow_stock_write', 'on', true);

  if p_variant_id is not null then
    update public.offering_variants
       set stock_qty = stock_qty + p_quantity
     where id = p_variant_id and tenant_id = p_tenant_id;
  else
    update public.materials
       set current_stock = current_stock + p_quantity
     where id = p_material_id and tenant_id = p_tenant_id;
  end if;

  if not found then
    raise exception 'позиция не найдена в арендаторе %', p_tenant_id;
  end if;

  return v_row;
end;
$$;

-- Захватывает остаток под заказ. Блокирует строку варианта (for update),
-- поэтому два одновременных заказа физически не могут забрать одну и ту же
-- последнюю единицу — гонка решается на уровне базы, не проверкой в коде.
create or replace function public.reserve_stock(
  p_tenant_id      uuid,
  p_variant_id     uuid,
  p_quantity       int,
  p_reference_type text,
  p_reference_id   uuid,
  p_expires_at     timestamptz default null
)
returns public.stock_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_variant public.offering_variants;
  v_row     public.stock_reservations;
  v_actor   uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'резерв требует авторизованного пользователя';
  end if;
  if not public.tenant_can(p_tenant_id, 'orders.write') then
    raise exception 'недостаточно прав: orders.write в арендаторе %', p_tenant_id;
  end if;
  if p_quantity <= 0 then
    raise exception 'количество резерва должно быть положительным';
  end if;

  select * into v_variant from public.offering_variants
   where id = p_variant_id and tenant_id = p_tenant_id
   for update;

  if not found then
    raise exception 'вариант % не найден в арендаторе %', p_variant_id, p_tenant_id;
  end if;

  if v_variant.track_stock
     and (v_variant.stock_qty - v_variant.reserved_qty) < p_quantity then
    raise exception 'недостаточно остатка: доступно %, запрошено %',
      v_variant.stock_qty - v_variant.reserved_qty, p_quantity;
  end if;

  insert into public.stock_reservations
    (tenant_id, variant_id, quantity, reference_type, reference_id, expires_at, created_by)
  values
    (p_tenant_id, p_variant_id, p_quantity, p_reference_type, p_reference_id, p_expires_at, v_actor)
  returning * into v_row;

  if v_variant.track_stock then
    perform set_config('vitrina.allow_stock_write', 'on', true);
    update public.offering_variants
       set reserved_qty = reserved_qty + p_quantity
     where id = p_variant_id;
  end if;

  return v_row;
end;
$$;

-- Снимает резерв. Идемпотентна: повторный вызов на уже снятом резерве
-- не ошибка, а no-op — ретрай отмены заказа не может дважды вернуть остаток.
create or replace function public.release_reservation(p_reservation_id uuid)
returns public.stock_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.stock_reservations;
begin
  select * into v_res from public.stock_reservations
   where id = p_reservation_id for update;

  if not found then
    raise exception 'резерв % не найден', p_reservation_id;
  end if;
  if v_res.status <> 'active' then
    return v_res;
  end if;
  if not public.tenant_can(v_res.tenant_id, 'orders.write') then
    raise exception 'недостаточно прав: orders.write в арендаторе %', v_res.tenant_id;
  end if;

  update public.stock_reservations set status = 'released'
   where id = p_reservation_id
   returning * into v_res;

  perform set_config('vitrina.allow_stock_write', 'on', true);
  update public.offering_variants
     set reserved_qty = reserved_qty - v_res.quantity
   where id = v_res.variant_id;

  return v_res;
end;
$$;

-- Превращает резерв в фактическую продажу: снимает резерв и списывает
-- остаток одним движением 'sale' — атомарно, оба эффекта или ни одного.
create or replace function public.commit_reservation(
  p_reservation_id uuid,
  p_note           text default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res  public.stock_reservations;
  v_move public.stock_movements;
begin
  select * into v_res from public.stock_reservations
   where id = p_reservation_id for update;

  if not found then
    raise exception 'резерв % не найден', p_reservation_id;
  end if;
  if v_res.status <> 'active' then
    raise exception 'резерв % в статусе % — не активен', p_reservation_id, v_res.status;
  end if;
  if not public.tenant_can(v_res.tenant_id, 'orders.write') then
    raise exception 'недостаточно прав: orders.write в арендаторе %', v_res.tenant_id;
  end if;

  update public.stock_reservations set status = 'committed' where id = p_reservation_id;

  perform set_config('vitrina.allow_stock_write', 'on', true);
  update public.offering_variants
     set reserved_qty = reserved_qty - v_res.quantity
   where id = v_res.variant_id;

  v_move := public.record_stock_movement(
    p_tenant_id      => v_res.tenant_id,
    p_movement_type  => 'sale',
    p_quantity       => -v_res.quantity,
    p_variant_id     => v_res.variant_id,
    p_reference_type => v_res.reference_type,
    p_reference_id   => v_res.reference_id,
    p_note           => p_note
  );

  return v_move;
end;
$$;

-- Списывает расходники по рецепту (variant_materials) за N проданных/оказанных
-- единиц варианта — одной транзакцией на все материалы сразу. Либо спишутся
-- все компоненты рецепта, либо ни один: половинчатого списания, из-за которого
-- в прошлом проекте расходники «терялись», здесь быть не может.
create or replace function public.consume_materials_for_variant(
  p_tenant_id      uuid,
  p_variant_id     uuid,
  p_units          numeric,
  p_reference_type text,
  p_reference_id   uuid,
  p_note           text default null
)
returns setof public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line record;
begin
  if p_units <= 0 then
    raise exception 'количество единиц должно быть положительным';
  end if;

  for v_line in
    select material_id, quantity_per_unit
      from public.variant_materials
     where variant_id = p_variant_id
  loop
    return next public.record_stock_movement(
      p_tenant_id      => p_tenant_id,
      p_movement_type  => 'write_off',
      p_quantity       => -(v_line.quantity_per_unit * p_units),
      p_material_id    => v_line.material_id,
      p_reference_type => p_reference_type,
      p_reference_id   => p_reference_id,
      p_note           => p_note
    );
  end loop;

  return;
end;
$$;

-- Проводит приёмку: каждая строка становится движением 'receipt',
-- документ помечается применённым. Пустую приёмку провести нельзя.
create or replace function public.apply_stock_receipt(p_receipt_id uuid)
returns public.stock_receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.stock_receipts;
  v_line    record;
  v_lines   int;
begin
  select * into v_receipt from public.stock_receipts
   where id = p_receipt_id for update;

  if not found then
    raise exception 'приёмка % не найдена', p_receipt_id;
  end if;
  if v_receipt.status <> 'draft' then
    raise exception 'приёмка % в статусе % — уже проведена или отменена', p_receipt_id, v_receipt.status;
  end if;
  if not public.tenant_can(v_receipt.tenant_id, 'stock.write') then
    raise exception 'недостаточно прав: stock.write в арендаторе %', v_receipt.tenant_id;
  end if;

  select count(*) into v_lines from public.stock_receipt_lines where receipt_id = p_receipt_id;
  if v_lines = 0 then
    raise exception 'в приёмке % нет ни одной строки', p_receipt_id;
  end if;

  for v_line in
    select * from public.stock_receipt_lines where receipt_id = p_receipt_id
  loop
    perform public.record_stock_movement(
      p_tenant_id      => v_receipt.tenant_id,
      p_movement_type  => 'receipt',
      p_quantity       => v_line.quantity,
      p_variant_id     => v_line.variant_id,
      p_material_id    => v_line.material_id,
      p_reference_type => 'stock_receipt',
      p_reference_id   => p_receipt_id,
      p_receipt_id     => p_receipt_id,
      p_note           => v_receipt.note
    );
  end loop;

  update public.stock_receipts
     set status = 'applied', applied_at = now(), applied_by = auth.uid()
   where id = p_receipt_id
   returning * into v_receipt;

  return v_receipt;
end;
$$;

-- Начинает инвентаризацию: снимает снимок текущего остатка по указанным
-- вариантам как expected_qty. Без снимка «пересчитали и сравнили с базой»
-- сравнивает две движущиеся цели.
create or replace function public.start_stock_count(
  p_tenant_id  uuid,
  p_variant_ids uuid[]
)
returns public.stock_counts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count public.stock_counts;
begin
  if not public.tenant_can(p_tenant_id, 'stock.write') then
    raise exception 'недостаточно прав: stock.write в арендаторе %', p_tenant_id;
  end if;
  if auth.uid() is null then
    raise exception 'инвентаризация требует авторизованного пользователя';
  end if;

  insert into public.stock_counts (tenant_id, started_by)
  values (p_tenant_id, auth.uid())
  returning * into v_count;

  insert into public.stock_count_lines (count_id, variant_id, expected_qty)
  select v_count.id, v.id, v.stock_qty
    from public.offering_variants v
   where v.id = any(p_variant_ids)
     and v.tenant_id = p_tenant_id;

  return v_count;
end;
$$;

-- Проводит инвентаризацию: расхождения (посчитано ≠ ожидалось) становятся
-- движениями 'adjustment'. Строки без расхождения и без введённого counted_qty
-- движений не порождают.
create or replace function public.apply_stock_count(p_count_id uuid)
returns public.stock_counts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count public.stock_counts;
  v_line  record;
begin
  select * into v_count from public.stock_counts where id = p_count_id for update;

  if not found then
    raise exception 'инвентаризация % не найдена', p_count_id;
  end if;
  if v_count.status <> 'counting' then
    raise exception 'инвентаризация % в статусе % — не идёт пересчёт', p_count_id, v_count.status;
  end if;
  if not public.tenant_can(v_count.tenant_id, 'stock.write') then
    raise exception 'недостаточно прав: stock.write в арендаторе %', v_count.tenant_id;
  end if;

  for v_line in
    select * from public.stock_count_lines
     where count_id = p_count_id
       and counted_qty is not null
       and counted_qty <> expected_qty
  loop
    perform public.record_stock_movement(
      p_tenant_id      => v_count.tenant_id,
      p_movement_type  => 'adjustment',
      p_quantity       => v_line.counted_qty - v_line.expected_qty,
      p_variant_id     => v_line.variant_id,
      p_reference_type => 'stock_count',
      p_reference_id   => p_count_id,
      p_count_id       => p_count_id
    );
  end loop;

  update public.stock_counts
     set status = 'applied', applied_at = now(), applied_by = auth.uid()
   where id = p_count_id
   returning * into v_count;

  return v_count;
end;
$$;

grant execute on function
  public.record_stock_movement, public.reserve_stock, public.release_reservation,
  public.commit_reservation, public.consume_materials_for_variant,
  public.apply_stock_receipt, public.start_stock_count, public.apply_stock_count
  to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- Журналы (stock_movements, material — через ту же таблицу) читаются
-- участниками склада, но НЕ пишутся напрямую: вставка только через
-- record_stock_movement (SECURITY DEFINER, выполняется от имени владельца
-- таблиц и поэтому проходит мимо RLS). Прямой insert для authenticated
-- сознательно не разрешён — иначе журнал можно исказить в обход проверки
-- знака и без обновления кэша.

alter table public.materials             enable row level security;
alter table public.variant_materials     enable row level security;
alter table public.stock_movements       enable row level security;
alter table public.stock_reservations    enable row level security;
alter table public.stock_receipts        enable row level security;
alter table public.stock_receipt_lines   enable row level security;
alter table public.stock_counts          enable row level security;
alter table public.stock_count_lines     enable row level security;

create policy materials_member_read on public.materials
  for select to authenticated using (tenant_id in (select public.tenants_with('stock.read')));

create policy materials_member_write on public.materials
  for all to authenticated
  using      (tenant_id in (select public.tenants_with('stock.write')))
  with check (tenant_id in (select public.tenants_with('stock.write')));

create policy variant_materials_read on public.variant_materials
  for select to authenticated
  using (exists (
    select 1 from public.offering_variants v
     where v.id = variant_materials.variant_id
       and v.tenant_id in (select public.tenants_with('catalog.read'))
  ));

create policy variant_materials_write on public.variant_materials
  for all to authenticated
  using (exists (
    select 1 from public.offering_variants v
     where v.id = variant_materials.variant_id
       and v.tenant_id in (select public.tenants_with('catalog.write'))
  ))
  with check (exists (
    select 1 from public.offering_variants v
     where v.id = variant_materials.variant_id
       and v.tenant_id in (select public.tenants_with('catalog.write'))
  ));

create policy stock_movements_read on public.stock_movements
  for select to authenticated using (tenant_id in (select public.tenants_with('stock.read')));

create policy stock_reservations_read on public.stock_reservations
  for select to authenticated using (tenant_id in (select public.tenants_with('orders.read')));

create policy stock_receipts_read on public.stock_receipts
  for select to authenticated using (tenant_id in (select public.tenants_with('stock.read')));

create policy stock_receipts_write on public.stock_receipts
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('stock.write')));

create policy stock_receipts_update on public.stock_receipts
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('stock.write')) and status = 'draft')
  with check (tenant_id in (select public.tenants_with('stock.write')));

create policy stock_receipt_lines_read on public.stock_receipt_lines
  for select to authenticated
  using (exists (
    select 1 from public.stock_receipts r
     where r.id = stock_receipt_lines.receipt_id
       and r.tenant_id in (select public.tenants_with('stock.read'))
  ));

create policy stock_receipt_lines_write on public.stock_receipt_lines
  for all to authenticated
  using (exists (
    select 1 from public.stock_receipts r
     where r.id = stock_receipt_lines.receipt_id
       and r.tenant_id in (select public.tenants_with('stock.write'))
  ))
  with check (exists (
    select 1 from public.stock_receipts r
     where r.id = stock_receipt_lines.receipt_id
       and r.tenant_id in (select public.tenants_with('stock.write'))
  ));

create policy stock_counts_read on public.stock_counts
  for select to authenticated using (tenant_id in (select public.tenants_with('stock.read')));

create policy stock_count_lines_read on public.stock_count_lines
  for select to authenticated
  using (exists (
    select 1 from public.stock_counts c
     where c.id = stock_count_lines.count_id
       and c.tenant_id in (select public.tenants_with('stock.read'))
  ));

-- Ввод посчитанного количества по ходу пересчёта — обычная правка данных,
-- не движение остатка, поэтому идёт мимо функций напрямую.
create policy stock_count_lines_update on public.stock_count_lines
  for update to authenticated
  using (exists (
    select 1 from public.stock_counts c
     where c.id = stock_count_lines.count_id
       and c.tenant_id in (select public.tenants_with('stock.write'))
       and c.status = 'counting'
  ))
  with check (exists (
    select 1 from public.stock_counts c
     where c.id = stock_count_lines.count_id
       and c.tenant_id in (select public.tenants_with('stock.write'))
  ));
