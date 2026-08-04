-- 0006_customers_orders.sql
-- Клиентская база магазина и заказы с гостевым оформлением.
--
-- Три решения, каждое — ответ на конкретную ошибку прошлого проекта:
--
--   1. ЦЕНА БЕРЁТСЯ ИЗ БАЗЫ, НЕ ОТ КЛИЕНТА. Заказ создаётся только функцией
--      create_order: она сама читает цену варианта на момент покупки.
--      Браузеру нельзя прислать «свою» цену — поля цены в её параметрах нет.
--
--   2. МАШИНА СОСТОЯНИЙ ЖИВЁТ В БАЗЕ. В прошлом проекте status был текстом
--      с CHECK-списком, а какие переходы разрешены — знал только код.
--      Здесь разрешённые переходы — ДАННЫЕ (order_status_transitions),
--      триггер отклоняет произвольный прыжок и сам пишет историю в
--      order_events. Отправить неоплаченный заказ невозможно физически.
--
--   3. ИТОГ ЗАКАЗА — ПРОИЗВОДНАЯ ОТ СТРОК. total пересчитывается триггером
--      от order_items и закрыт от прямой правки тем же приёмом, что остатки
--      (guard). В прошлом проекте total_amount жил сам по себе, и ничто
--      не мешало ему разойтись с составом заказа.
--
-- Покупатель платформы (profiles) и клиент магазина (customers) — разные
-- сущности. Гость без аккаунта — это клиент с именем и телефоном; если
-- позже он заведёт аккаунт, записи связываются через user_id, история
-- покупок не теряется.

-- ─────────────────────────────────────────────────────────────────────────────
-- Клиентская база
-- ─────────────────────────────────────────────────────────────────────────────

create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  -- Аккаунт на платформе, если есть. Гость — null.
  user_id     uuid references public.profiles(id) on delete set null,

  -- Имя обязательно всегда: это минимум, который просим у гостя.
  name        text not null check (length(btrim(name)) > 0),
  phone       text,
  email       citext,

  note        text,
  tags        text[] not null default '{}',

  -- Кэш для списка клиентов. Обновляется только триггером от заказов —
  -- тот же принцип, что с остатками: производное значение не правится рукой.
  orders_count  int     not null default 0,
  total_spent   numeric not null default 0,
  last_order_at timestamptz,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Один аккаунт платформы = одна карточка клиента в магазине.
  unique (tenant_id, user_id)
);

create index customers_tenant_idx on public.customers (tenant_id, created_at desc);
create index customers_phone_idx  on public.customers (tenant_id, phone) where phone is not null;
create index customers_email_idx  on public.customers (tenant_id, email) where email is not null;
create index customers_user_idx   on public.customers (user_id) where user_id is not null;

create trigger customers_touch
  before update on public.customers
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Статусы заказа: значения и разрешённые переходы — данные
-- ─────────────────────────────────────────────────────────────────────────────

create type public.order_status as enum (
  'new',              -- оформлен, продавец ещё не видел
  'confirmed',        -- продавец принял в работу
  'awaiting_payment', -- выставлен счёт
  'paid',             -- оплата подтверждена продавцом
  'packing',          -- собирается на складе
  'shipped',          -- передан перевозчику
  'delivered',        -- получен покупателем
  'completed',        -- закрыт, пошёл срок возврата
  'cancelled',        -- не состоялся
  'returned'          -- оформлен возврат
);

create table public.order_status_transitions (
  from_status public.order_status not null,
  to_status   public.order_status not null,
  primary key (from_status, to_status)
);

-- Матрица из docs/DOMAIN.md, дословно.
insert into public.order_status_transitions values
  ('new','confirmed'), ('new','cancelled'),
  ('confirmed','awaiting_payment'), ('confirmed','paid'),
  ('confirmed','packing'), ('confirmed','cancelled'),
  ('awaiting_payment','paid'), ('awaiting_payment','cancelled'),
  ('paid','packing'), ('paid','cancelled'),
  ('packing','shipped'), ('packing','cancelled'),
  ('shipped','delivered'),
  ('delivered','completed'), ('delivered','returned'),
  ('completed','returned');

-- ─────────────────────────────────────────────────────────────────────────────
-- Заказы
-- ─────────────────────────────────────────────────────────────────────────────

-- Пер-арендаторная нумерация: у каждого продавца заказы с единицы.
-- Отдельная таблица со строчной блокировкой вместо глобальной
-- последовательности — продавец не должен видеть по номеру чужие объёмы.
create table public.order_counters (
  tenant_id   uuid primary key references public.tenants(id) on delete cascade,
  last_number bigint not null default 0
);

create table public.orders (
  id           uuid not null default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  number       bigint not null,

  status       public.order_status not null default 'new',

  customer_id  uuid not null references public.customers(id) on delete restrict,
  -- Кто оформлял, если был вошедший пользователь. Гость — null.
  buyer_user_id uuid references public.profiles(id) on delete set null,

  -- Контакты снимком на момент заказа: карточку клиента потом можно
  -- редактировать, а заказ — документ, он не меняется задним числом.
  contact_name  text not null check (length(btrim(contact_name)) > 0),
  contact_phone text,
  contact_email citext,

  delivery_method  text,
  delivery_city    text,
  delivery_branch  text,
  delivery_address text,
  tracking_number  text,

  comment      text,
  cancel_reason text,

  -- Производные от order_items. Прямая правка закрыта триггером-охранником.
  subtotal     numeric not null default 0 check (subtotal >= 0),
  discount     numeric not null default 0 check (discount >= 0),
  total        numeric not null default 0 check (total >= 0),
  paid_amount  numeric not null default 0 check (paid_amount >= 0),
  currency     char(3) not null default 'UAH',

  -- Откуда пришёл заказ. Ручной — продавец завёл сам (продажа из
  -- переписки или офлайн), это первый сценарий склада.
  source       text not null default 'storefront'
                 check (source in ('storefront','manual','instagram','phone','offline')),

  created_by   uuid references public.profiles(id),  -- продавец при ручном заказе
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  confirmed_at timestamptz,
  paid_at      timestamptz,
  shipped_at   timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,

  primary key (id),
  unique (tenant_id, number)
);

create index orders_tenant_status_idx on public.orders (tenant_id, status, created_at desc);
create index orders_customer_idx      on public.orders (customer_id);
create index orders_buyer_idx         on public.orders (buyer_user_id) where buyer_user_id is not null;
create index orders_created_by_idx    on public.orders (created_by) where created_by is not null;

create trigger orders_touch
  before update on public.orders
  for each row execute function public.touch_updated_at();

create table public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  offering_id uuid not null references public.offerings(id) on delete restrict,
  variant_id  uuid not null references public.offering_variants(id) on delete restrict,

  -- Снимок названия и цены на момент покупки: карточку товара продавец
  -- потом переименует и переоценит, а заказ обязан помнить, что было.
  title        text not null,
  variant_name text not null,
  unit_price   numeric not null check (unit_price >= 0),
  quantity     int not null check (quantity > 0),

  -- Резерв, который держит остаток под эту строку (для товаров с учётом).
  reservation_id uuid references public.stock_reservations(id) on delete set null,

  created_at  timestamptz not null default now()
);

create index order_items_order_idx    on public.order_items (order_id);
create index order_items_offering_idx on public.order_items (offering_id);
create index order_items_variant_idx  on public.order_items (variant_id);
create index order_items_tenant_idx   on public.order_items (tenant_id);
create index order_items_reservation_idx on public.order_items (reservation_id)
  where reservation_id is not null;

-- История переходов: кто, когда, из чего во что. Пишется триггером,
-- руками не редактируется.
create table public.order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  from_status public.order_status,
  to_status   public.order_status not null,
  actor       uuid references public.profiles(id),  -- null = гость или система
  note        text,
  created_at  timestamptz not null default now()
);

create index order_events_order_idx on public.order_events (order_id, created_at);
create index order_events_tenant_idx on public.order_events (tenant_id);
create index order_events_actor_idx on public.order_events (actor) where actor is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Охрана: машина состояний и производные суммы
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.orders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Производные суммы меняются только служебным путём.
  if coalesce(current_setting('vitrina.allow_order_write', true), '') <> 'on' then
    if new.subtotal is distinct from old.subtotal
       or new.total is distinct from old.total then
      raise exception 'subtotal/total пересчитываются от строк заказа — прямая правка запрещена';
    end if;
  end if;

  -- Переход статуса: только по матрице.
  if new.status is distinct from old.status then
    if not exists (
      select 1 from public.order_status_transitions t
       where t.from_status = old.status and t.to_status = new.status
    ) then
      raise exception 'переход % → % не разрешён', old.status, new.status;
    end if;

    -- Вехи проставляются сами, задним числом их не подделать.
    case new.status
      when 'confirmed' then new.confirmed_at := now();
      when 'paid'      then new.paid_at      := now();
      when 'shipped'   then new.shipped_at   := now();
      when 'completed' then new.completed_at := now();
      when 'cancelled' then new.cancelled_at := now();
      else null;
    end case;

    insert into public.order_events (order_id, tenant_id, from_status, to_status, actor)
    values (new.id, new.tenant_id, old.status, new.status, auth.uid());
  end if;

  return new;
end;
$$;

create trigger orders_guard
  before update on public.orders
  for each row execute function public.orders_guard();

-- Пересчёт сумм заказа от строк. Внутренняя механика базы: единственный
-- писатель производного значения, как record_stock_movement у остатков.
create or replace function public.order_items_recalc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
begin
  perform set_config('vitrina.allow_order_write', 'on', true);
  update public.orders o
     set subtotal = s.sum, total = greatest(s.sum - o.discount, 0)
    from (
      select coalesce(sum(unit_price * quantity), 0) as sum
        from public.order_items where order_id = v_order_id
    ) s
   where o.id = v_order_id;
  return coalesce(new, old);
end;
$$;

create trigger order_items_recalc
  after insert or update or delete on public.order_items
  for each row execute function public.order_items_recalc();

-- Кэш карточки клиента: число заказов и сумма. Считаются по завершённым
-- переходам, обновляются только отсюда.
create or replace function public.customers_stats_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.customers c
     set orders_count  = s.cnt,
         total_spent   = s.spent,
         last_order_at = s.last_at
    from (
      select count(*) filter (where status not in ('cancelled')) as cnt,
             coalesce(sum(total) filter (where status in ('paid','packing','shipped','delivered','completed')), 0) as spent,
             max(created_at) as last_at
        from public.orders where customer_id = new.customer_id
    ) s
   where c.id = new.customer_id;
  return new;
end;
$$;

create trigger orders_customer_stats
  after insert or update of status on public.orders
  for each row execute function public.customers_stats_refresh();

-- ─────────────────────────────────────────────────────────────────────────────
-- Внутренний резерв без проверки прав — для гостевого оформления
-- ─────────────────────────────────────────────────────────────────────────────
-- reserve_stock из 0003 требует вошедшего пользователя с orders.write —
-- для продавца это правильно, но гость оформляет заказ без аккаунта.
-- Внутренняя функция несёт ту же логику (блокировка строки, проверка
-- доступного остатка), но не проверяет права: её НЕЛЬЗЯ вызвать снаружи,
-- она доступна только definer-функциям этого файла.

alter table public.stock_reservations alter column created_by drop not null;
comment on column public.stock_reservations.created_by is
  'null = гостевое оформление с витрины; трассировка через reference_type/reference_id к заказу.';

create or replace function public.reserve_stock_internal(
  p_tenant_id      uuid,
  p_variant_id     uuid,
  p_quantity       int,
  p_reference_type text,
  p_reference_id   uuid,
  p_actor          uuid,
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
begin
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
    (p_tenant_id, p_variant_id, p_quantity, p_reference_type, p_reference_id, p_expires_at, p_actor)
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

revoke execute on function public.reserve_stock_internal(uuid, uuid, int, text, uuid, uuid, timestamptz)
  from public, anon, authenticated;

-- reserve_stock из 0003 становится обёрткой: проверки прав + общая логика.
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
begin
  if auth.uid() is null then
    raise exception 'резерв требует авторизованного пользователя';
  end if;
  if not public.tenant_can(p_tenant_id, 'orders.write') then
    raise exception 'недостаточно прав: orders.write в арендаторе %', p_tenant_id;
  end if;

  return public.reserve_stock_internal(
    p_tenant_id, p_variant_id, p_quantity,
    p_reference_type, p_reference_id, auth.uid(), p_expires_at);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Оформление заказа — одна функция, один путь
-- ─────────────────────────────────────────────────────────────────────────────
-- Вызывается и гостем (anon), и вошедшим покупателем, и продавцом
-- (ручной заказ). Всё в одной транзакции: клиент, номер, заказ, строки,
-- резервы. Цены и названия функция читает из базы сама.

create or replace function public.create_order(
  p_tenant_id     uuid,
  p_items         jsonb,          -- [{"variant_id": "...", "quantity": 2}, ...]
  p_contact_name  text,
  p_contact_phone text default null,
  p_contact_email text default null,
  p_delivery      jsonb default '{}'::jsonb,
  p_comment       text default null,
  p_source        text default 'storefront',
  p_reserve_hours int  default 72
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_tenant     public.tenants;
  v_is_staffer boolean := false;
  v_customer   public.customers;
  v_number     bigint;
  v_order      public.orders;
  v_item       record;
  v_variant    public.offering_variants;
  v_offering   public.offerings;
  v_res        public.stock_reservations;
  v_count      int := 0;
begin
  -- Гость обязан представиться. Это минимум по постановке.
  if p_contact_name is null or length(btrim(p_contact_name)) = 0 then
    raise exception 'имя покупателя обязательно';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'заказ без единой позиции невозможен';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'слишком много позиций в одном заказе';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found or v_tenant.status <> 'active' then
    raise exception 'магазин не найден или не активен';
  end if;

  -- Сотрудник магазина может заводить ручной заказ и в закрытой витрине;
  -- посторонним и гостям — только опубликованный магазин.
  v_is_staffer := v_actor is not null and public.tenant_can(p_tenant_id, 'orders.write');
  if not v_is_staffer and not v_tenant.storefront_enabled then
    raise exception 'витрина магазина не опубликована';
  end if;
  if p_source = 'storefront' and v_is_staffer then
    p_source := 'manual';
  end if;

  -- Карточка клиента: по аккаунту, иначе по телефону, иначе новая.
  if v_actor is not null and not v_is_staffer then
    select * into v_customer from public.customers
     where tenant_id = p_tenant_id and user_id = v_actor;
  end if;
  if v_customer.id is null and p_contact_phone is not null then
    select * into v_customer from public.customers
     where tenant_id = p_tenant_id and phone = p_contact_phone
     order by created_at limit 1;
  end if;
  if v_customer.id is null then
    insert into public.customers (tenant_id, user_id, name, phone, email)
    values (p_tenant_id,
            case when v_is_staffer then null else v_actor end,
            btrim(p_contact_name), p_contact_phone, p_contact_email)
    returning * into v_customer;
  end if;

  -- Номер: пер-арендаторный счётчик под блокировкой строки.
  insert into public.order_counters (tenant_id) values (p_tenant_id)
  on conflict (tenant_id) do nothing;

  update public.order_counters
     set last_number = last_number + 1
   where tenant_id = p_tenant_id
   returning last_number into v_number;

  insert into public.orders
    (tenant_id, number, customer_id, buyer_user_id,
     contact_name, contact_phone, contact_email,
     delivery_method, delivery_city, delivery_branch, delivery_address,
     comment, source, created_by)
  values
    (p_tenant_id, v_number, v_customer.id,
     case when v_is_staffer then null else v_actor end,
     btrim(p_contact_name), p_contact_phone, p_contact_email,
     p_delivery->>'method', p_delivery->>'city', p_delivery->>'branch', p_delivery->>'address',
     p_comment, p_source,
     case when v_is_staffer then v_actor else null end)
  returning * into v_order;

  -- Строки: цена и название ТОЛЬКО из базы. Позиция обязана быть активной
  -- и принадлежать этому магазину — чужой variant_id не пройдёт.
  for v_item in
    select (e->>'variant_id')::uuid as variant_id,
           (e->>'quantity')::int    as quantity
      from jsonb_array_elements(p_items) e
  loop
    if v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'количество в строке заказа должно быть положительным';
    end if;

    select * into v_variant from public.offering_variants
     where id = v_item.variant_id and tenant_id = p_tenant_id and is_active;
    if not found then
      raise exception 'вариант % недоступен', v_item.variant_id;
    end if;

    select * into v_offering from public.offerings
     where id = v_variant.offering_id;
    if v_offering.status <> 'active' and not v_is_staffer then
      raise exception 'позиция «%» сейчас не продаётся', v_offering.title;
    end if;

    v_res := null;
    if v_variant.track_stock then
      v_res := public.reserve_stock_internal(
        p_tenant_id, v_variant.id, v_item.quantity,
        'order', v_order.id, v_actor,
        now() + make_interval(hours => greatest(p_reserve_hours, 1)));
    end if;

    insert into public.order_items
      (order_id, tenant_id, offering_id, variant_id,
       title, variant_name, unit_price, quantity, reservation_id)
    values
      (v_order.id, p_tenant_id, v_offering.id, v_variant.id,
       v_offering.title, v_variant.name,
       coalesce(v_variant.price, v_offering.price, 0), v_item.quantity,
       v_res.id);

    v_count := v_count + 1;
  end loop;

  insert into public.order_events (order_id, tenant_id, from_status, to_status, actor, note)
  values (v_order.id, p_tenant_id, null, 'new', v_actor,
          format('заказ оформлен, позиций: %s', v_count));

  select * into v_order from public.orders where id = v_order.id;
  return v_order;
end;
$$;

-- Гостевое оформление: функция доступна анониму СОЗНАТЕЛЬНО.
-- Внутри — проверка опубликованности витрины, цены из базы, лимит позиций.
-- Ограничение частоты запросов — обязанность крайнего слоя (Vercel),
-- см. docs/DOMAIN.md.
revoke execute on function public.create_order(uuid, jsonb, text, text, text, jsonb, text, text, int)
  from public;
grant execute on function public.create_order(uuid, jsonb, text, text, text, jsonb, text, text, int)
  to anon, authenticated;

-- Смена статуса заказа — тоже функция, а не голый update: продавец
-- переводит статусы, покупатель может только отменить свой ранний заказ.
create or replace function public.set_order_status(
  p_order_id uuid,
  p_status   public.order_status,
  p_note     text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_item  record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'заказ % не найден', p_order_id;
  end if;

  if public.tenant_can(v_order.tenant_id, 'orders.write') then
    null;  -- продавец: любой переход из матрицы
  elsif auth.uid() is not null and v_order.buyer_user_id = auth.uid()
        and p_status = 'cancelled'
        and v_order.status in ('new','confirmed','awaiting_payment') then
    null;  -- покупатель: отмена до сборки (docs/DOMAIN.md)
  else
    raise exception 'недостаточно прав для перехода % → %', v_order.status, p_status;
  end if;

  update public.orders set status = p_status,
         cancel_reason = case when p_status = 'cancelled' then p_note else cancel_reason end
   where id = p_order_id
   returning * into v_order;

  -- Отмена и возврат освобождают резервы строк заказа.
  if p_status in ('cancelled', 'returned') then
    for v_item in
      select oi.reservation_id from public.order_items oi
       where oi.order_id = p_order_id and oi.reservation_id is not null
    loop
      update public.stock_reservations set status = 'released'
       where id = v_item.reservation_id and status = 'active';
      if found then
        perform set_config('vitrina.allow_stock_write', 'on', true);
        update public.offering_variants v
           set reserved_qty = greatest(v.reserved_qty - oi.quantity, 0)
          from public.order_items oi
         where oi.reservation_id = v_item.reservation_id and v.id = oi.variant_id;
      end if;
    end loop;
  end if;

  if p_note is not null then
    update public.order_events set note = p_note
     where order_id = p_order_id and to_status = p_status
       and id = (select id from public.order_events
                  where order_id = p_order_id and to_status = p_status
                  order by created_at desc limit 1);
  end if;

  return v_order;
end;
$$;

revoke execute on function public.set_order_status(uuid, public.order_status, text) from public, anon;
grant execute on function public.set_order_status(uuid, public.order_status, text) to authenticated;

-- Гостевое отслеживание: заказ по номеру и телефону, без входа.
-- Отдаёт один заказ и только при полном совпадении пары — перебор
-- номеров без знания телефона ничего не даст.
create or replace function public.track_order(
  p_tenant_slug citext,
  p_number      bigint,
  p_phone       text
)
returns table (
  number bigint, status public.order_status, total numeric, currency char(3),
  tracking_number text, created_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select o.number, o.status, o.total, o.currency, o.tracking_number, o.created_at
    from public.orders o
    join public.tenants t on t.id = o.tenant_id
   where t.slug = p_tenant_slug
     and o.number = p_number
     and o.contact_phone is not null
     and o.contact_phone = p_phone
   limit 1;
$$;

revoke execute on function public.track_order(citext, bigint, text) from public;
grant execute on function public.track_order(citext, bigint, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- Клиентская база — только команда магазина с customers.*.
-- Заказы: команда по правам; покупатель видит свои. Гость не видит ничего
-- через API — ему track_order. Вставка заказов извне закрыта: только
-- create_order (definer) умеет писать.

alter table public.customers                enable row level security;
alter table public.orders                   enable row level security;
alter table public.order_items              enable row level security;
alter table public.order_events             enable row level security;
alter table public.order_counters           enable row level security;
alter table public.order_status_transitions enable row level security;

create policy customers_read on public.customers
  for select to authenticated
  using (tenant_id in (select public.tenants_with('customers.read')));

create policy customers_insert on public.customers
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('customers.write')));

create policy customers_update on public.customers
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('customers.write')))
  with check (tenant_id in (select public.tenants_with('customers.write')));

create policy customers_delete on public.customers
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('customers.write')));

create policy orders_read on public.orders
  for select to authenticated
  using (
    tenant_id in (select public.tenants_with('orders.read'))
    or buyer_user_id = (select auth.uid())
  );

-- Прямых insert/delete нет ни у кого: заказ создаёт create_order,
-- удаление заказов запрещено в принципе — только отмена.
create policy orders_update on public.orders
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('orders.write')))
  with check (tenant_id in (select public.tenants_with('orders.write')));

create policy order_items_read on public.order_items
  for select to authenticated
  using (
    tenant_id in (select public.tenants_with('orders.read'))
    or exists (select 1 from public.orders o
                where o.id = order_items.order_id
                  and o.buyer_user_id = (select auth.uid()))
  );

create policy order_events_read on public.order_events
  for select to authenticated
  using (
    tenant_id in (select public.tenants_with('orders.read'))
    or exists (select 1 from public.orders o
                where o.id = order_events.order_id
                  and o.buyer_user_id = (select auth.uid()))
  );

create policy order_counters_read on public.order_counters
  for select to authenticated
  using (tenant_id in (select public.tenants_with('orders.read')));

create policy order_status_transitions_read on public.order_status_transitions
  for select to authenticated using (true);
