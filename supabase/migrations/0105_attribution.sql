-- ===========================================================================
-- 0105. Атрибуция. Ссылка из шапки Instagram помечает заказ и запись.
-- ===========================================================================
--
-- ЧТО ОБЕЩАНО. Продавец кладёт в шапку Instagram ссылку
-- `cres-ca.com/t/<slug>?from=ig`; переход по ней помечает заказ или запись
-- как «привёл продавец сам». Это не отчётность ради отчётности — это то,
-- из чего в будущем считается счёт: «0% с заказов, которые продавец привёл
-- сам, комиссия только с приведённых нами». Без атрибуции биллинг
-- невозможен в принципе — сначала «откуда пришёл заказ», потом счета
-- (порядок из CLAUDE.md, раздел «Биллинг»).
--
-- КОРРЕКЦИЯ. Прежняя запись в CLAUDE.md утверждала «таблицы под это есть,
-- механики нет» — это было неверно: ни `attribution_events`, ни колонок
-- на заказах/записях не существовало вовсе. Поймано при построении модуля,
-- исправлено прямо здесь и в тексте документа.
--
-- ── ГДЕ ЖИВЁТ РЕШЕНИЕ «СВОЙ / НАШ» ────────────────────────────────────────
--
-- Источник — одно из пяти значений: `ig` (шапка Instagram), `direct`
-- (прямая ссылка вне Instagram — QR, мессенджер), `search`/`map`
-- (найден через поиск или карту маркетплейса), `referral` (заведено под
-- будущую реферальную механику, CLAUDE.md → «Бизнес-модель без
-- реализации», сейчас не выставляется никем).
--
-- ОТСУТСТВИЕ атрибуции (нет `from=`, окно истекло) — это ТОЖЕ «свой»:
-- модель денег построена от обратного, «0% — это дефолт, комиссия только
-- при ДОКАЗАННОМ канале платформы». Ошибка в пользу продавца дешевле
-- ошибки в пользу платформы: обратное означало бы выставлять счета
-- за трафик, который платформа не приводила.
--
-- ── ОКНО 30 ДНЕЙ И ПОСЛЕДНИЙ ПЕРЕХОД ────────────────────────────────────────
--
-- Источник и момент перехода несёт КЛИЕНТ (браузер помнит последний переход
-- по ссылке — «последний переход побеждает», это уже поведение обычной
-- куки с перезаписью). Здесь, на границе с базой, — только защита: если
-- присланный момент в будущем или старше 30 дней, атрибуция ИГНОРИРУЕТСЯ,
-- а не отклоняет заказ. Клиент, соврав в timestamp, испортит только
-- статистику канала — не чек-аут: это внутренняя бухгалтерия между
-- платформой и продавцом, а не проверка доступа.
--
-- ── ПОЧЕМУ АТРИБУЦИЯ НИКОГДА НЕ РОНЯЕТ ЗАКАЗ ─────────────────────────────
--
-- `attribution_resolve()` не бросает исключений ни при каком входе:
-- неизвестное значение, null, будущая дата — всё превращается в NULL,
-- и оформление идёт как обычно. Урок 0087 (ограничитель частоты) тот же:
-- механика, которая в сомнении отказывает, ломает продажи первым же
-- вызовом с испорченными данными — а cookie в браузере испортить проще,
-- чем заголовок HTTP.
--
-- ── ПОЧЕМУ `create_order` ТРОГАЕТСЯ, ХОТЯ ЕГО СЕГОДНЯ НИКТО НЕ ЗОВЁТ ────────
--
-- У витрины нет оформления заказа на товар — ни кошика, ни формы; кнопка
-- есть только у услуг («Записатися» → `create_booking`). Это отдельный,
-- крупный и не отменённый пробел (CLAUDE.md → «Осталось по складу…» рядом
-- со списком несделанного), а не повод резать API пополам. `create_order`
-- уже вторая из восьми анонимных точек (правило 7) и не приобретает
-- девятую — только новые опциональные параметры существующей. Пока кошика
-- нет, они просто не заполняются никем; появится кошик — ему не придётся
-- ждать отдельной миграции на атрибуцию.
-- ===========================================================================

create type public.attribution_source as enum ('ig', 'direct', 'search', 'map', 'referral');

alter table public.orders
  add column if not exists attribution_source public.attribution_source,
  add column if not exists attribution_label text;

alter table public.bookings
  add column if not exists attribution_source public.attribution_source,
  add column if not exists attribution_label text;

-- ── 1. Разбор присланного источника: никогда не бросает исключений ─────────

create or replace function public.attribution_resolve(p_source text, p_at timestamptz)
returns public.attribution_source
language plpgsql
stable
set search_path to ''
as $$
declare
  v_src public.attribution_source;
begin
  if p_source is null or p_at is null then
    return null;
  end if;
  -- Будущее — явно испорченные часы клиента; старше 30 дней — окно
  -- атрибуции истекло (CLAUDE.md → «Ссылка из шапки Instagram»).
  if p_at > now() + interval '5 minutes' or p_at < now() - interval '30 days' then
    return null;
  end if;
  begin
    v_src := p_source::public.attribution_source;
  exception when invalid_text_representation then
    return null;
  end;
  return v_src;
end;
$$;

comment on function public.attribution_resolve(text, timestamptz) is
  'Источник перехода → значение перечисления либо null. Не бросает исключений ни при каком входе: атрибуция — внутренняя бухгалтерия, а не проверка доступа, и не должна ронять оформление заказа.';

revoke all on function public.attribution_resolve(text, timestamptz) from public;
revoke all on function public.attribution_resolve(text, timestamptz) from anon;
revoke all on function public.attribution_resolve(text, timestamptz) from authenticated;

-- ── 2. Журнал атрибутированных конверсий ────────────────────────────────────
--
-- Не журнал ВСЕХ переходов по ссылке (это отдельное решение — см. правило 7
-- ниже), а журнал того, что действительно закончилось заказом или записью.
-- Строка появляется ТОЛЬКО вместе со своим заказом/записью, внутри той же
-- транзакции, что и они, — второго источника правды не заводим.

create table public.attribution_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  source      public.attribution_source not null,
  label       text,
  order_id    uuid references public.orders(id) on delete set null,
  booking_id  uuid references public.bookings(id) on delete set null,
  -- Момент ПЕРЕХОДА по ссылке (из cookie клиента), а не момент заказа —
  -- иначе отчёт «сколько привёл Instagram в марте» считал бы по дате
  -- покупки и путал бы канал с воронкой.
  occurred_at timestamptz not null,
  created_at  timestamptz not null default now(),

  check ((order_id is not null) <> (booking_id is not null))
);

-- Один атрибутированный источник на документ. Составной с tenant_id —
-- правило 1, без исключений, даже когда сами id и так глобально уникальны
-- (тот же приём, что в 0104 для отзывов).
create unique index attribution_events_order_uidx
  on public.attribution_events (tenant_id, order_id) where order_id is not null;
create unique index attribution_events_booking_uidx
  on public.attribution_events (tenant_id, booking_id) where booking_id is not null;

create index attribution_events_tenant_idx
  on public.attribution_events (tenant_id, occurred_at desc);

alter table public.attribution_events enable row level security;

drop policy if exists attribution_events_read on public.attribution_events;
create policy attribution_events_read on public.attribution_events
  for select using (tenant_id in (select public.tenants_with('orders.read')));

-- Политик на INSERT нет: строка пишется только изнутри `create_order`
-- и `create_booking`, вместе с самим документом. Прямая вставка обошла бы
-- проверку «источник этого заказа/записи совпадает с фактом их создания».

revoke all on table public.attribution_events from public;
revoke all on table public.attribution_events from anon;
revoke all on table public.attribution_events from authenticated;
grant select on table public.attribution_events to authenticated;

-- ===========================================================================
-- 3. create_order и create_booking — три новых опциональных параметра.
--
-- Тела ниже — ДОСЛОВНАЯ КОПИЯ действующих на бою функций (сверено
-- побайтово через pg_get_functiondef перед правкой), с добавлением РОВНО
-- трёх параметров в конец списка, вычисления источника и записи атрибуции.
-- Ни одна существующая строка не переставлена и не переформулирована —
-- урок правила письма миграций: «or replace» без этого стирает чужую
-- работу молча (0076 — предупреждение, вынесенное в CLAUDE.md).
--
-- ДОБАВЛЕНИЕ ПАРАМЕТРА МЕНЯЕТ СИГНАТУРУ: `create or replace` создал бы
-- ВТОРОЙ, отдельный овердлоад рядом со старым, и вызовы стали бы
-- неоднозначными (тот же урок, что и с `decant_container` в 0100).
-- Поэтому сначала DROP старой сигнатуры, потом CREATE новой.
-- ===========================================================================

drop function if exists public.create_order(uuid, jsonb, text, text, text, jsonb, text, text, integer);

create function public.create_order(
  p_tenant_id uuid,
  p_items jsonb,
  p_contact_name text,
  p_contact_phone text default null::text,
  p_contact_email text default null::text,
  p_delivery jsonb default '{}'::jsonb,
  p_comment text default null::text,
  p_source text default 'storefront'::text,
  p_reserve_hours integer default 72,
  p_attribution_source text default null,
  p_attribution_label text default null,
  p_attribution_at timestamptz default null
)
returns orders
language plpgsql
security definer
set search_path to ''
as $function$
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
  v_ip         inet;
  v_gate       record;
  v_attr       public.attribution_source;
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

  -- Источник атрибуции. Сотруднику, оформляющему заказ вручную, атрибуция
  -- не нужна и не считается: ручной заказ — это и есть «привёл продавец
  -- сам» по определению.
  if not v_is_staffer then
    v_attr := public.attribution_resolve(p_attribution_source, p_attribution_at);
  end if;

  -- Предел частоты: 10 заказов в час с одного адреса (0087). Ставится
  -- ДО первой записи — иначе отказ оставлял бы за собой карточку клиента
  -- и съеденный номер заказа. Адреса нет — пропускаем, а не отказываем.
  if not v_is_staffer then
    v_ip := public.request_ip();
    if v_ip is not null then
      select * into v_gate
        from public.rate_hit('order:' || host(v_ip), 10, interval '1 hour');
      if not v_gate.allowed then
        raise exception 'слишком много заказов с одного адреса, попробуйте через % с',
          v_gate.retry_after;
      end if;
    end if;
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
     comment, source, created_by, attribution_source, attribution_label)
  values
    (p_tenant_id, v_number, v_customer.id,
     case when v_is_staffer then null else v_actor end,
     btrim(p_contact_name), p_contact_phone, p_contact_email,
     p_delivery->>'method', p_delivery->>'city', p_delivery->>'branch', p_delivery->>'address',
     p_comment, p_source,
     case when v_is_staffer then v_actor else null end,
     v_attr, nullif(btrim(coalesce(p_attribution_label, '')), ''))
  returning * into v_order;

  if v_attr is not null then
    insert into public.attribution_events (tenant_id, source, label, order_id, occurred_at)
    values (p_tenant_id, v_attr, nullif(btrim(coalesce(p_attribution_label, '')), ''),
            v_order.id, p_attribution_at);
  end if;

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
$function$;

comment on function public.create_order(uuid, jsonb, text, text, text, jsonb, text, text, integer, text, text, timestamptz) is
  'Оформление заказа. Три последних параметра — атрибуция (0105): источник перехода, метка, момент перехода. Отсутствие или устаревание атрибуции не влияет на оформление — источник тогда null (=«привёл продавец сам»).';

revoke all on function public.create_order(uuid, jsonb, text, text, text, jsonb, text, text, integer, text, text, timestamptz) from public;
revoke all on function public.create_order(uuid, jsonb, text, text, text, jsonb, text, text, integer, text, text, timestamptz) from anon;
revoke all on function public.create_order(uuid, jsonb, text, text, text, jsonb, text, text, integer, text, text, timestamptz) from authenticated;
grant execute on function public.create_order(uuid, jsonb, text, text, text, jsonb, text, text, integer, text, text, timestamptz) to anon, authenticated;

-- ── create_booking — тот же приём ───────────────────────────────────────────

drop function if exists public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text);

create function public.create_booking(
  p_tenant_id uuid,
  p_variant_id uuid,
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_contact_name text,
  p_contact_phone text default null::text,
  p_comment text default null::text,
  p_attribution_source text default null,
  p_attribution_label text default null,
  p_attribution_at timestamptz default null
)
returns bookings
language plpgsql
security definer
set search_path to ''
as $function$
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
  v_ip       inet;
  v_gate     record;
  v_attr     public.attribution_source;
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

  if not v_staffer then
    v_attr := public.attribution_resolve(p_attribution_source, p_attribution_at);
  end if;

  -- Предел частоты: 10 записей в час с одного адреса (0087). Ставится
  -- ДО первой записи — отказ не должен оставлять за собой ни карточки
  -- клиента, ни съеденного номера. Адреса нет — пропускаем.
  if not v_staffer then
    v_ip := public.request_ip();
    if v_ip is not null then
      select * into v_gate
        from public.rate_hit('booking:' || host(v_ip), 10, interval '1 hour');
      if not v_gate.allowed then
        raise exception 'слишком много записей с одного адреса, попробуйте через % с',
          v_gate.retry_after;
      end if;
    end if;
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
     contact_name, contact_phone, comment, buyer_user_id, created_by,
     attribution_source, attribution_label)
  values
    (p_tenant_id, v_number, p_staff_id, v_offering.id, v_variant.id, v_customer.id,
     v_period, v_ends, v_offering.title, v_variant.name,
     coalesce(v_variant.price, v_offering.price, 0),
     round(coalesce(v_variant.price, v_offering.price, 0) * v_offering.deposit_percent / 100.0, 2),
     btrim(p_contact_name), p_contact_phone, p_comment,
     case when v_staffer then null else v_actor end,
     case when v_staffer then v_actor else null end,
     v_attr, nullif(btrim(coalesce(p_attribution_label, '')), ''))
  returning * into v_row;

  if v_attr is not null then
    insert into public.attribution_events (tenant_id, source, label, booking_id, occurred_at)
    values (p_tenant_id, v_attr, nullif(btrim(coalesce(p_attribution_label, '')), ''),
            v_row.id, p_attribution_at);
  end if;

  return v_row;
exception
  when exclusion_violation then
    raise exception 'это время уже занято — выберите другое';
end;
$function$;

comment on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text, timestamptz) is
  'Запись на услугу. Три последних параметра — атрибуция (0105), см. create_order.';

revoke all on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text, timestamptz) from public;
revoke all on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text, timestamptz) from anon;
revoke all on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text, timestamptz) from authenticated;
grant execute on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text, timestamptz) to anon, authenticated;
