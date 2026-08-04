-- 0010_bookings.sql
-- Запись на услуги: мастера, графики, слоты, брони, депозит.
--
-- Главное решение: ДВОЙНОЕ БРОНИРОВАНИЕ НЕВОЗМОЖНО НА УРОВНЕ БАЗЫ,
-- а не проверкой в коде. Проверка «свободно ли время» с последующей
-- вставкой всегда проигрывает гонке двух одновременных записей: обе
-- читают «свободно», обе пишут. Здесь пересечение интервалов у одного
-- мастера запрещено ограничением исключения (exclusion constraint) —
-- вторая транзакция получает отказ от Postgres, а не от нашей удачи.
--
-- Второе решение: слоты НЕ ХРАНЯТСЯ, а вычисляются. Таблица «свободных
-- слотов» — классическая ошибка: её надо пересоздавать при каждом
-- изменении графика, отпуска, длительности услуги, и она немедленно
-- расходится с реальностью. Слоты считает функция из графика, брони
-- и длительности с буфером.
--
-- Услуга — это та же позиция каталога (offerings.kind = 'service'),
-- никакой параллельной сущности. Здесь добавляются только те свойства,
-- которых у товара не бывает: длительность, буфер, кто оказывает.

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- Мастера
-- ─────────────────────────────────────────────────────────────────────────────
-- Мастер — это участник магазина (tenant_members) с расписанием.
-- Отдельная таблица, а не флаг в членстве: у мастера есть публичное имя
-- и фото для витрины, которые не совпадают с учётной записью.

create table public.staff (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete set null,

  name        text not null check (length(btrim(name)) > 0),
  title       text,                       -- «майстер манікюру»
  avatar_path text,
  bio         text,

  -- Часовой пояс мастера. Обязателен: клиент из другого города должен
  -- видеть время мастера, а не своё (docs/DOMAIN.md).
  timezone    text not null default 'Europe/Kyiv',

  is_active   boolean not null default true,
  position    int not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (tenant_id, user_id)
);

create index staff_tenant_idx on public.staff (tenant_id, position) where is_active;
create index staff_user_idx   on public.staff (user_id) where user_id is not null;

create trigger staff_touch
  before update on public.staff
  for each row execute function public.touch_updated_at();

-- Какие услуги оказывает мастер. Пусто = оказывает все услуги магазина.
create table public.staff_services (
  staff_id    uuid not null references public.staff(id) on delete cascade,
  offering_id uuid not null references public.offerings(id) on delete cascade,
  primary key (staff_id, offering_id)
);

create index staff_services_offering_idx on public.staff_services (offering_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Свойства услуги
-- ─────────────────────────────────────────────────────────────────────────────
-- Длительность живёт на варианте: «манікюр 60 хв» и «манікюр з дизайном
-- 90 хв» — это два варианта одной позиции, как размеры у товара.

alter table public.offering_variants
  add column duration_minutes int check (duration_minutes > 0),
  -- Буфер после услуги: убрать, проветрить, продезинфицировать.
  add column buffer_minutes   int not null default 0 check (buffer_minutes >= 0);

alter table public.offerings
  -- Депозит при записи: процент от цены. 0 = без предоплаты.
  -- Собирается эквайрингом ПРОДАВЦА (ADR 0005), платформа денег не видит.
  add column deposit_percent  int not null default 0
    check (deposit_percent between 0 and 100),
  -- За сколько часов до визита клиент ещё может отменить сам.
  add column cancel_window_hours int not null default 24
    check (cancel_window_hours >= 0),
  -- Насколько вперёд открыта запись.
  add column booking_horizon_days int not null default 60
    check (booking_horizon_days between 1 and 365);

-- Услуга обязана иметь длительность, товар обязан её не иметь.
-- CHECK здесь не годится: условие зависит от ДРУГОЙ таблицы (offerings.kind),
-- а CHECK не имеет права заглядывать за пределы своей строки. Поэтому
-- триггер — это не «обход правила», а единственный законный способ
-- выразить межтабличный инвариант.
create or replace function public.variants_require_duration()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_kind public.offering_kind;
begin
  select kind into v_kind from public.offerings where id = new.offering_id;
  if v_kind = 'service' and new.duration_minutes is null then
    raise exception 'у варианта услуги обязана быть длительность';
  end if;
  if v_kind = 'product' and new.duration_minutes is not null then
    raise exception 'у товара не бывает длительности — это свойство услуги';
  end if;
  return new;
end;
$$;

create trigger offering_variants_duration
  before insert or update on public.offering_variants
  for each row execute function public.variants_require_duration();

revoke execute on function public.variants_require_duration() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- График работы
-- ─────────────────────────────────────────────────────────────────────────────
-- Регулярная неделя + исключения (отпуск, больничный, разовая подмена).

create table public.working_hours (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  staff_id   uuid not null references public.staff(id) on delete cascade,

  weekday    int  not null check (weekday between 0 and 6),  -- 0 = воскресенье
  starts_at  time not null,
  ends_at    time not null,

  check (ends_at > starts_at)
);

create index working_hours_staff_idx on public.working_hours (staff_id, weekday);
create index working_hours_tenant_idx on public.working_hours (tenant_id);

create type public.time_off_kind as enum ('vacation', 'sick', 'break', 'other');

create table public.time_off (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  staff_id   uuid not null references public.staff(id) on delete cascade,

  kind       public.time_off_kind not null default 'other',
  period     tstzrange not null,
  note       text,

  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),

  check (not isempty(period))
);

create index time_off_staff_idx  on public.time_off using gist (staff_id, period);
create index time_off_tenant_idx on public.time_off (tenant_id);
create index time_off_created_by_idx on public.time_off (created_by) where created_by is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Брони
-- ─────────────────────────────────────────────────────────────────────────────

create type public.booking_status as enum (
  'booked',      -- клиент выбрал время
  'confirmed',   -- мастер подтвердил
  'arrived',     -- клиент пришёл
  'completed',   -- услуга оказана, можно оставить отзыв
  'cancelled',   -- отменена (клиентом или мастером)
  'no_show'      -- не пришёл
);

create table public.bookings (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  number      bigint not null,

  staff_id    uuid not null references public.staff(id) on delete restrict,
  offering_id uuid not null references public.offerings(id) on delete restrict,
  variant_id  uuid not null references public.offering_variants(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,

  -- Интервал, который реально занят у мастера: услуга + буфер.
  -- Именно по нему работает запрет пересечений.
  period      tstzrange not null,
  -- Время окончания самой услуги, без буфера — его видит клиент.
  service_ends_at timestamptz not null,

  status      public.booking_status not null default 'booked',

  -- Снимок на момент записи: цену и название потом поменяют.
  title        text not null,
  variant_name text not null,
  price        numeric not null check (price >= 0),
  deposit_due  numeric not null default 0 check (deposit_due >= 0),
  deposit_paid numeric not null default 0 check (deposit_paid >= 0),
  currency     char(3) not null default 'UAH',

  contact_name  text not null check (length(btrim(contact_name)) > 0),
  contact_phone text,
  comment       text,
  cancel_reason text,

  buyer_user_id uuid references public.profiles(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  primary key (id),
  unique (tenant_id, number),
  check (not isempty(period)),
  check (deposit_paid <= deposit_due or deposit_due = 0)
);

-- ГЛАВНОЕ ОГРАНИЧЕНИЕ ФАЙЛА.
-- Один мастер не может быть занят дважды в пересекающееся время.
-- Отменённые и «не пришёл» из проверки исключены: освободившееся время
-- обязано снова стать доступным.
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    staff_id with =,
    period   with &&
  ) where (status not in ('cancelled', 'no_show'));

create index bookings_tenant_period_idx on public.bookings using gist (tenant_id, period);
create index bookings_staff_idx    on public.bookings (staff_id, status);
create index bookings_customer_idx on public.bookings (customer_id);
create index bookings_buyer_idx    on public.bookings (buyer_user_id) where buyer_user_id is not null;
create index bookings_offering_idx on public.bookings (offering_id);
create index bookings_variant_idx  on public.bookings (variant_id);
create index bookings_created_by_idx on public.bookings (created_by) where created_by is not null;
create index bookings_upcoming_idx on public.bookings (tenant_id, lower(period))
  where status in ('booked','confirmed');

create trigger bookings_touch
  before update on public.bookings
  for each row execute function public.touch_updated_at();

create table public.booking_counters (
  tenant_id   uuid primary key references public.tenants(id) on delete cascade,
  last_number bigint not null default 0
);

-- Переходы статусов брони — тоже данные, как у заказов.
create table public.booking_status_transitions (
  from_status public.booking_status not null,
  to_status   public.booking_status not null,
  primary key (from_status, to_status)
);

insert into public.booking_status_transitions values
  ('booked','confirmed'), ('booked','cancelled'), ('booked','no_show'), ('booked','arrived'),
  ('confirmed','arrived'), ('confirmed','cancelled'), ('confirmed','no_show'),
  ('arrived','completed'), ('arrived','cancelled'),
  ('completed','cancelled');

create or replace function public.bookings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and not exists (
       select 1 from public.booking_status_transitions t
        where t.from_status = old.status and t.to_status = new.status
     ) then
    raise exception 'переход брони % → % не разрешён', old.status, new.status;
  end if;
  return new;
end;
$$;

create trigger bookings_guard
  before update on public.bookings
  for each row execute function public.bookings_guard();

revoke execute on function public.bookings_guard() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Свободные слоты — вычисляются, не хранятся
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.available_slots(
  p_tenant_id  uuid,
  p_variant_id uuid,
  p_from       date,
  p_to         date,
  p_staff_id   uuid default null,
  p_step_minutes int default 15
)
returns table (staff_id uuid, staff_name text, starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_variant  public.offering_variants;
  v_offering public.offerings;
  v_tenant   public.tenants;
  v_total    int;
begin
  select * into v_variant from public.offering_variants
   where id = p_variant_id and tenant_id = p_tenant_id and is_active;
  if not found or v_variant.duration_minutes is null then
    return;
  end if;

  select * into v_offering from public.offerings where id = v_variant.offering_id;
  select * into v_tenant   from public.tenants   where id = p_tenant_id;

  -- Витрина закрыта — слоты наружу не отдаём. Сотруднику магазина можно.
  if not (v_tenant.status = 'active'
          and (v_tenant.storefront_enabled or public.tenant_can(p_tenant_id, 'orders.read'))) then
    return;
  end if;
  if v_offering.status <> 'active' and not public.tenant_can(p_tenant_id, 'orders.read') then
    return;
  end if;

  v_total := v_variant.duration_minutes + v_variant.buffer_minutes;

  -- Ограничиваем горизонт: и по настройке услуги, и жёстко по длине окна,
  -- чтобы анонимный вызов не мог попросить пять лет вперёд.
  p_to := least(p_to,
                (current_date + make_interval(days => v_offering.booking_horizon_days))::date,
                (p_from + 62));
  if p_to < p_from then
    return;
  end if;

  return query
  with days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') d
  ),
  masters as (
    select s.id, s.name, s.timezone
      from public.staff s
     where s.tenant_id = p_tenant_id and s.is_active
       and (p_staff_id is null or s.id = p_staff_id)
       and (not exists (select 1 from public.staff_services ss where ss.staff_id = s.id)
            or exists (select 1 from public.staff_services ss
                        where ss.staff_id = s.id and ss.offering_id = v_offering.id))
  ),
  windows as (
    select m.id as staff_id, m.name as staff_name,
           ((d.day + w.starts_at) at time zone m.timezone) as win_start,
           ((d.day + w.ends_at)   at time zone m.timezone) as win_end
      from days d
      join masters m on true
      join public.working_hours w
        on w.staff_id = m.id
       and w.weekday = extract(dow from d.day)::int
  ),
  candidates as (
    select w.staff_id, w.staff_name,
           gs as slot_start,
           gs + make_interval(mins => v_total) as slot_end
      from windows w
      cross join lateral generate_series(
        w.win_start, w.win_end - make_interval(mins => v_total),
        make_interval(mins => greatest(p_step_minutes, 5))
      ) gs
     where w.win_end > w.win_start
  )
  select c.staff_id, c.staff_name, c.slot_start,
         c.slot_start + make_interval(mins => v_variant.duration_minutes)
    from candidates c
   where c.slot_start > now()
     and not exists (
       select 1 from public.bookings b
        where b.staff_id = c.staff_id
          and b.status not in ('cancelled','no_show')
          and b.period && tstzrange(c.slot_start, c.slot_end, '[)')
     )
     and not exists (
       select 1 from public.time_off t
        where t.staff_id = c.staff_id
          and t.period && tstzrange(c.slot_start, c.slot_end, '[)')
     )
   order by c.slot_start, c.staff_name;
end;
$$;

-- Слоты видит и гость: без этого нет ссылки записи в шапке Instagram.
revoke execute on function public.available_slots(uuid, uuid, date, date, uuid, int) from public;
grant  execute on function public.available_slots(uuid, uuid, date, date, uuid, int) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Запись
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.create_booking(
  p_tenant_id     uuid,
  p_variant_id    uuid,
  p_staff_id      uuid,
  p_starts_at     timestamptz,
  p_contact_name  text,
  p_contact_phone text default null,
  p_comment       text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_staffer  boolean := false;
  v_tenant   public.tenants;
  v_variant  public.offering_variants;
  v_offering public.offerings;
  v_customer public.customers;
  v_number   bigint;
  v_row      public.bookings;
  v_ends     timestamptz;
  v_period   tstzrange;
begin
  if p_contact_name is null or length(btrim(p_contact_name)) = 0 then
    raise exception 'имя клиента обязательно';
  end if;
  if p_starts_at <= now() then
    raise exception 'нельзя записаться в прошлое';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found or v_tenant.status <> 'active' then
    raise exception 'магазин не найден или не активен';
  end if;

  v_staffer := v_actor is not null and public.tenant_can(p_tenant_id, 'orders.write');
  if not v_staffer and not v_tenant.storefront_enabled then
    raise exception 'запись закрыта: витрина не опубликована';
  end if;

  select * into v_variant from public.offering_variants
   where id = p_variant_id and tenant_id = p_tenant_id and is_active;
  if not found or v_variant.duration_minutes is null then
    raise exception 'услуга недоступна для записи';
  end if;

  select * into v_offering from public.offerings where id = v_variant.offering_id;
  if v_offering.status <> 'active' and not v_staffer then
    raise exception 'услуга «%» сейчас не оказывается', v_offering.title;
  end if;

  if not exists (select 1 from public.staff s
                  where s.id = p_staff_id and s.tenant_id = p_tenant_id and s.is_active) then
    raise exception 'мастер не найден';
  end if;

  v_ends   := p_starts_at + make_interval(mins => v_variant.duration_minutes);
  v_period := tstzrange(p_starts_at,
                        v_ends + make_interval(mins => v_variant.buffer_minutes), '[)');

  -- Отпуск проверяем явно: ограничение исключения его не покрывает.
  if exists (select 1 from public.time_off t
              where t.staff_id = p_staff_id and t.period && v_period) then
    raise exception 'мастер не работает в это время';
  end if;

  -- Карточка клиента: по аккаунту, иначе по телефону, иначе новая.
  if v_actor is not null and not v_staffer then
    select * into v_customer from public.customers
     where tenant_id = p_tenant_id and user_id = v_actor;
  end if;
  if v_customer.id is null and p_contact_phone is not null then
    select * into v_customer from public.customers
     where tenant_id = p_tenant_id and phone = p_contact_phone
     order by created_at limit 1;
  end if;
  if v_customer.id is null then
    insert into public.customers (tenant_id, user_id, name, phone)
    values (p_tenant_id, case when v_staffer then null else v_actor end,
            btrim(p_contact_name), p_contact_phone)
    returning * into v_customer;
  end if;

  insert into public.booking_counters (tenant_id) values (p_tenant_id)
  on conflict (tenant_id) do nothing;
  update public.booking_counters set last_number = last_number + 1
   where tenant_id = p_tenant_id returning last_number into v_number;

  -- Если время занято, здесь сработает bookings_no_overlap и транзакция
  -- откатится целиком. Гонка двух одновременных записей решается базой.
  insert into public.bookings
    (tenant_id, number, staff_id, offering_id, variant_id, customer_id,
     period, service_ends_at, title, variant_name, price, deposit_due,
     contact_name, contact_phone, comment, buyer_user_id, created_by)
  values
    (p_tenant_id, v_number, p_staff_id, v_offering.id, v_variant.id, v_customer.id,
     v_period, v_ends, v_offering.title, v_variant.name,
     coalesce(v_variant.price, v_offering.price, 0),
     round(coalesce(v_variant.price, v_offering.price, 0) * v_offering.deposit_percent / 100.0, 2),
     btrim(p_contact_name), p_contact_phone, p_comment,
     case when v_staffer then null else v_actor end,
     case when v_staffer then v_actor else null end)
  returning * into v_row;

  return v_row;
exception
  when exclusion_violation then
    raise exception 'это время уже занято — выберите другое';
end;
$$;

revoke execute on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text) from public;
grant  execute on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text) to anon, authenticated;

-- Перенос и отмена клиентом — в пределах окна, заданного продавцом.
create or replace function public.reschedule_booking(
  p_booking_id uuid,
  p_starts_at  timestamptz,
  p_staff_id   uuid default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b        public.bookings;
  v_variant  public.offering_variants;
  v_offering public.offerings;
  v_staff    uuid;
  v_ends     timestamptz;
  v_period   tstzrange;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'запись не найдена';
  end if;
  if v_b.status in ('cancelled','completed','no_show') then
    raise exception 'запись в статусе % не переносится', v_b.status;
  end if;

  select * into v_offering from public.offerings where id = v_b.offering_id;

  if public.tenant_can(v_b.tenant_id, 'orders.write') then
    null;
  elsif auth.uid() is not null and v_b.buyer_user_id = auth.uid() then
    if lower(v_b.period) - now() < make_interval(hours => v_offering.cancel_window_hours) then
      raise exception 'перенести можно не позже чем за % ч до визита',
        v_offering.cancel_window_hours;
    end if;
  else
    raise exception 'недостаточно прав для переноса записи';
  end if;

  if p_starts_at <= now() then
    raise exception 'нельзя перенести в прошлое';
  end if;

  select * into v_variant from public.offering_variants where id = v_b.variant_id;
  v_staff  := coalesce(p_staff_id, v_b.staff_id);
  v_ends   := p_starts_at + make_interval(mins => v_variant.duration_minutes);
  v_period := tstzrange(p_starts_at,
                        v_ends + make_interval(mins => v_variant.buffer_minutes), '[)');

  if exists (select 1 from public.time_off t
              where t.staff_id = v_staff and t.period && v_period) then
    raise exception 'мастер не работает в это время';
  end if;

  update public.bookings
     set staff_id = v_staff, period = v_period, service_ends_at = v_ends
   where id = p_booking_id
   returning * into v_b;

  return v_b;
exception
  when exclusion_violation then
    raise exception 'это время уже занято — выберите другое';
end;
$$;

revoke execute on function public.reschedule_booking(uuid, timestamptz, uuid) from public, anon;
grant  execute on function public.reschedule_booking(uuid, timestamptz, uuid) to authenticated;

create or replace function public.set_booking_status(
  p_booking_id uuid,
  p_status     public.booking_status,
  p_note       text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b        public.bookings;
  v_offering public.offerings;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'запись не найдена';
  end if;
  select * into v_offering from public.offerings where id = v_b.offering_id;

  if public.tenant_can(v_b.tenant_id, 'orders.write') then
    null;
  elsif auth.uid() is not null and v_b.buyer_user_id = auth.uid()
        and p_status = 'cancelled' then
    if lower(v_b.period) - now() < make_interval(hours => v_offering.cancel_window_hours) then
      raise exception 'отменить можно не позже чем за % ч до визита',
        v_offering.cancel_window_hours;
    end if;
  else
    raise exception 'недостаточно прав для смены статуса записи';
  end if;

  update public.bookings
     set status = p_status,
         cancel_reason = case when p_status = 'cancelled' then p_note else cancel_reason end
   where id = p_booking_id
   returning * into v_b;

  -- Оказанная услуга списывает расходники по рецепту (техкарта).
  if p_status = 'completed' then
    perform public.consume_materials_for_variant(
      v_b.tenant_id, v_b.variant_id, 1, 'booking', v_b.id,
      format('послуга за записом №%s', v_b.number));
  end if;

  return v_b;
end;
$$;

revoke execute on function public.set_booking_status(uuid, public.booking_status, text) from public, anon;
grant  execute on function public.set_booking_status(uuid, public.booking_status, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.staff             enable row level security;
alter table public.staff_services    enable row level security;
alter table public.working_hours     enable row level security;
alter table public.time_off          enable row level security;
alter table public.bookings          enable row level security;
alter table public.booking_counters  enable row level security;
alter table public.booking_status_transitions enable row level security;

-- Мастера видны публично: их показывает витрина при выборе времени.
create policy staff_read on public.staff
  for select to anon, authenticated
  using (
    tenant_id in (select public.tenants_with('orders.read'))
    or (is_active and exists (select 1 from public.tenants t
                               where t.id = staff.tenant_id
                                 and t.status = 'active' and t.storefront_enabled))
  );

create policy staff_insert on public.staff
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('team.write')));

create policy staff_update on public.staff
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('team.write')))
  with check (tenant_id in (select public.tenants_with('team.write')));

create policy staff_delete on public.staff
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('team.write')));

create policy staff_services_read on public.staff_services
  for select to anon, authenticated using (true);

create policy staff_services_write on public.staff_services
  for insert to authenticated
  with check (exists (select 1 from public.staff s
                       where s.id = staff_services.staff_id
                         and s.tenant_id in (select public.tenants_with('team.write'))));

create policy staff_services_delete on public.staff_services
  for delete to authenticated
  using (exists (select 1 from public.staff s
                  where s.id = staff_services.staff_id
                    and s.tenant_id in (select public.tenants_with('team.write'))));

-- График виден публично: по нему витрина рисует календарь.
create policy working_hours_read on public.working_hours
  for select to anon, authenticated using (true);

create policy working_hours_insert on public.working_hours
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('orders.write')));

create policy working_hours_update on public.working_hours
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('orders.write')))
  with check (tenant_id in (select public.tenants_with('orders.write')));

create policy working_hours_delete on public.working_hours
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('orders.write')));

-- Причина отпуска — личное дело сотрудника, наружу не отдаём:
-- витрине достаточно того, что слот не предложен (это решает функция).
create policy time_off_read on public.time_off
  for select to authenticated
  using (tenant_id in (select public.tenants_with('orders.read')));

create policy time_off_insert on public.time_off
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('orders.write')));

create policy time_off_update on public.time_off
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('orders.write')))
  with check (tenant_id in (select public.tenants_with('orders.write')));

create policy time_off_delete on public.time_off
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('orders.write')));

create policy bookings_read on public.bookings
  for select to authenticated
  using (
    tenant_id in (select public.tenants_with('orders.read'))
    or buyer_user_id = (select auth.uid())
  );

create policy bookings_update on public.bookings
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('orders.write')))
  with check (tenant_id in (select public.tenants_with('orders.write')));

create policy booking_counters_read on public.booking_counters
  for select to authenticated
  using (tenant_id in (select public.tenants_with('orders.read')));

create policy booking_status_transitions_read on public.booking_status_transitions
  for select to authenticated using (true);
