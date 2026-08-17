-- ===========================================================================
-- 0103. Возвраты. Описаны в правилах домена и не построены.
-- ===========================================================================
--
-- ЧТО ОБЕЩАНО (docs/DOMAIN.md, повторено в CLAUDE.md): возврат заводится
-- ОТ ЗАКАЗА, наследует состав, причина обязательна, позиции возвращаются
-- на склад, доход по заказу снимается. Денег платформа не возвращает —
-- она фиксирует факт и правит учёт (ADR 0005: деньги покупателя через
-- платформу не идут вовсе).
--
-- До этой миграции возврата не существовало ни в каком виде: товар,
-- принесённый обратно, продавец «возвращал» ручной корректировкой остатка
-- с причиной в свободном тексте, а доход оставался в финансах навсегда.
-- То есть отчёт о прибыли врал ровно на сумму возвратов.
--
-- ── ТРИ РЕШЕНИЯ, КОТОРЫЕ ЗДЕСЬ ВАЖНЕЕ КОДА ────────────────────────────────
--
-- 1. ДОХОД НЕ УДАЛЯЕТСЯ, А ГАСИТСЯ ВСТРЕЧНОЙ ЗАПИСЬЮ. `finance_records`
--    неизменяемы (0007) по той же причине, что и журнал остатка: правка
--    задним числом превращает учёт в мнение. Возврат кладёт РАСХОД на
--    сумму возврата со ссылкой на тот же заказ. В отчёте это видно как
--    две строки — продали и вернули, — а не как «продажи не было».
--
-- 2. НА СКЛАД ВОЗВРАЩАЕТ `record_stock_movement`, А НЕ ПРЯМОЙ UPDATE.
--    Правило 5: остаток — кэш журнала. Тип движения `return` уже есть
--    в перечислении с 0003 и не использовался ни разу.
--
-- 3. КОЛИЧЕСТВО ОГРАНИЧЕНО ПРОДАННЫМ МИНУС УЖЕ ВОЗВРАЩЁННЫМ. Без этой
--    проверки два возврата по одному заказу заводят на склад товар,
--    которого не было, и остаток расходится с журналом — то есть ломается
--    единственное, на чём стоит весь склад.
--
-- ── ПРАВА: ДВА, А НЕ ОДНО ─────────────────────────────────────────────────
--
-- Возврат просит `orders.write` (это документ по заказу) И `stock.write`
-- (он заводит товар на склад). Одного `orders.write` мало: иначе продавец,
-- которому склад не доверен, меняет остаток через оформление возврата.
-- Проверка `stock.write` спрашивается ТОЛЬКО когда в возврате есть
-- позиции, возвращаемые на склад: возврат услуги склада не касается.
--
-- Финансовую запись создаёт сама функция и НЕ требует `finances.write` —
-- ровно как оплата заказа создаёт доход триггером (0007). Учёт правится
-- следствием действия, а не отдельным разрешением: иначе половина
-- возвратов оставляла бы доход висеть.
-- ===========================================================================

-- ── 1. Документ возврата ────────────────────────────────────────────────────

create table if not exists public.return_counters (
  tenant_id   uuid primary key references public.tenants(id) on delete cascade,
  last_number bigint not null default 0
);

create table if not exists public.returns (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  number     bigint not null,
  order_id   uuid not null references public.orders(id) on delete restrict,
  -- Причина обязательна и непустая. Возврат без причины — это дырка
  -- в учёте, которую через месяц никто не объяснит, и первый же спор
  -- с покупателем разбирается «по памяти».
  reason     text not null check (btrim(reason) <> ''),
  total      numeric(12,2) not null default 0 check (total >= 0),
  note       text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, number)
);

create index if not exists returns_tenant_idx on public.returns (tenant_id, created_at desc);
create index if not exists returns_order_idx  on public.returns (order_id);

create table if not exists public.return_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  return_id     uuid not null references public.returns(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  variant_id    uuid references public.offering_variants(id) on delete set null,
  title         text not null,
  variant_name  text,
  unit_price    numeric(12,2) not null,
  quantity      integer not null check (quantity > 0)
);

create index if not exists return_items_return_idx on public.return_items (return_id);
create index if not exists return_items_tenant_idx on public.return_items (tenant_id);
create index if not exists return_items_order_item_idx on public.return_items (order_item_id);

alter table public.return_counters enable row level security;
alter table public.returns         enable row level security;
alter table public.return_items    enable row level security;

-- ── 2. Документ неизменяем. Правится только заметка ─────────────────────────
--
-- Тот же приём, что у `finance_records` (0007) и журнала остатка: ошибочный
-- возврат не исправляется и не удаляется — он гасится обратной операцией.
-- Иначе «вернули на 8000» превращается в «вернули на 800» без следа.

create or replace function public.returns_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'повернення не видаляється: помилкове гаситься зустрічним, а не стиранням';
  end if;
  if new.tenant_id  is distinct from old.tenant_id
     or new.number   is distinct from old.number
     or new.order_id is distinct from old.order_id
     or new.reason   is distinct from old.reason
     or new.total    is distinct from old.total
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'у поверненні правиться лише примітка';
  end if;
  return new;
end;
$$;

drop trigger if exists returns_guard on public.returns;
create trigger returns_guard
  before update or delete on public.returns
  for each row execute function public.returns_guard();

create or replace function public.return_items_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  raise exception 'склад повернення не змінюється після проведення';
end;
$$;

drop trigger if exists return_items_guard on public.return_items;
create trigger return_items_guard
  before update or delete on public.return_items
  for each row execute function public.return_items_guard();

revoke all on function public.returns_guard() from public;
revoke all on function public.returns_guard() from anon;
revoke all on function public.returns_guard() from authenticated;
revoke all on function public.return_items_guard() from public;
revoke all on function public.return_items_guard() from anon;
revoke all on function public.return_items_guard() from authenticated;

-- ── 3. Политики: читают те, кто видит заказы; пишет только функция ──────────

drop policy if exists returns_read on public.returns;
create policy returns_read on public.returns
  for select using (tenant_id in (select public.tenants_with('orders.read')));

drop policy if exists return_items_read on public.return_items;
create policy return_items_read on public.return_items
  for select using (tenant_id in (select public.tenants_with('orders.read')));

drop policy if exists return_counters_read on public.return_counters;
create policy return_counters_read on public.return_counters
  for select using (tenant_id in (select public.tenants_with('orders.read')));

-- Политик на INSERT/UPDATE/DELETE нет, и это решение, а не упущение:
-- возврат заводится ТОЛЬКО через `create_return`, которая сверяет остаток
-- возвращаемого, двигает склад журналом и гасит доход. Прямая вставка
-- обошла бы всё три раза.

revoke all on table public.returns from public;
revoke all on table public.returns from anon;
revoke all on table public.returns from authenticated;
grant select on table public.returns to authenticated;

revoke all on table public.return_items from public;
revoke all on table public.return_items from anon;
revoke all on table public.return_items from authenticated;
grant select on table public.return_items to authenticated;

revoke all on table public.return_counters from public;
revoke all on table public.return_counters from anon;
revoke all on table public.return_counters from authenticated;
grant select on table public.return_counters to authenticated;

-- ── 4. Проведение возврата ──────────────────────────────────────────────────

create or replace function public.create_return(
  p_tenant_id uuid,
  p_order_id  uuid,
  p_reason    text,
  p_lines     jsonb
) returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
declare
  v_order    public.orders;
  v_line     jsonb;
  v_item     public.order_items;
  v_qty      integer;
  v_done     integer;
  v_number   bigint;
  v_ret      uuid;
  v_total    numeric(12,2) := 0;
  v_stock    boolean := false;
  v_actor    uuid := auth.uid();
  v_track    boolean;
begin
  if v_actor is null then
    raise exception 'повернення потребує авторизованого користувача';
  end if;
  if not public.tenant_can(p_tenant_id, 'orders.write') then
    raise exception 'недостатньо прав: orders.write у закладі %', p_tenant_id;
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'причина повернення обовʼязкова';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'повернення без жодної позиції не має сенсу';
  end if;

  select * into v_order from public.orders o
   where o.id = p_order_id and o.tenant_id = p_tenant_id;
  if not found then
    raise exception 'замовлення % немає в закладі %', p_order_id, p_tenant_id;
  end if;

  -- ПРОВЕРКА ЦЕЛИКОМ ДО ПЕРВОЙ ЗАПИСИ. Отказ на середине оставил бы
  -- документ без части движений склада — а это хуже отказа целиком:
  -- неизменяемый документ, который уже нельзя ни дописать, ни стереть.
  --
  -- Строки СНАЧАЛА СХЛОПЫВАЮТСЯ по позиции заказа. Одна и та же позиция,
  -- присланная дважды по одной штуке, иначе прошла бы обе проверки
  -- по отдельности и вернула бы на одну штуку больше проданного.
  for v_line in
    select jsonb_build_object('order_item_id', item_id, 'quantity', qty)
      from (select (l->>'order_item_id')::uuid as item_id,
                   sum(coalesce((l->>'quantity')::integer, 0)) as qty
              from jsonb_array_elements(p_lines) l
             group by 1) q
  loop
    select * into v_item from public.order_items i
     where i.id = (v_line->>'order_item_id')::uuid and i.order_id = p_order_id;
    if not found then
      raise exception 'позиції % немає в замовленні', v_line->>'order_item_id';
    end if;

    v_qty := (v_line->>'quantity')::integer;
    if v_qty <= 0 then
      raise exception 'кількість повернення має бути більшою за нуль';
    end if;

    select coalesce(sum(ri.quantity), 0) into v_done
      from public.return_items ri
     where ri.order_item_id = v_item.id;

    if v_qty > v_item.quantity - v_done then
      raise exception 'повернути можна не більше ніж продано: % з % (вже повернуто %)',
        v_qty, v_item.quantity, v_done;
    end if;

    v_total := v_total + v_item.unit_price * v_qty;

    if v_item.variant_id is not null then
      select v.track_stock into v_track from public.offering_variants v
       where v.id = v_item.variant_id;
      if coalesce(v_track, false) then v_stock := true; end if;
    end if;
  end loop;

  if v_stock and not public.tenant_can(p_tenant_id, 'stock.write') then
    raise exception 'недостатньо прав: stock.write — повернення заводить товар на склад';
  end if;

  insert into public.return_counters (tenant_id) values (p_tenant_id)
  on conflict (tenant_id) do nothing;
  update public.return_counters
     set last_number = last_number + 1
   where tenant_id = p_tenant_id
   returning last_number into v_number;

  -- Сумма проставляется СРАЗУ, а не апдейтом после сбора позиций:
  -- документ неизменяем с первой миллисекунды, и собственный сторож
  -- не пустил бы даже свой же `update ... set total`.
  insert into public.returns (tenant_id, number, order_id, reason, total, created_by)
  values (p_tenant_id, v_number, p_order_id, btrim(p_reason), v_total, v_actor)
  returning id into v_ret;

  for v_line in
    select jsonb_build_object('order_item_id', item_id, 'quantity', qty)
      from (select (l->>'order_item_id')::uuid as item_id,
                   sum(coalesce((l->>'quantity')::integer, 0)) as qty
              from jsonb_array_elements(p_lines) l
             group by 1) q
  loop
    select * into v_item from public.order_items i
     where i.id = (v_line->>'order_item_id')::uuid and i.order_id = p_order_id;
    v_qty := (v_line->>'quantity')::integer;

    insert into public.return_items
      (tenant_id, return_id, order_item_id, variant_id, title, variant_name,
       unit_price, quantity)
    values
      (p_tenant_id, v_ret, v_item.id, v_item.variant_id, v_item.title,
       v_item.variant_name, v_item.unit_price, v_qty);

    -- На склад — только то, что на складе считается. Услуга и товар
    -- без учёта остатка возвращаются документом, но не движением.
    if v_item.variant_id is not null then
      select v.track_stock into v_track from public.offering_variants v
       where v.id = v_item.variant_id;
      if coalesce(v_track, false) then
        perform public.record_stock_movement(
          p_tenant_id, 'return', v_qty, v_item.variant_id, null,
          'return', v_ret, null, null,
          'повернення №' || v_number::text,
          -- Ключ идемпотентности собран из документа и позиции: повтор
          -- запроса не заведёт товар на склад дважды.
          'return:' || v_ret::text || ':' || v_item.id::text);
      end if;
    end if;
  end loop;

  -- Доход гасится встречной записью, а не удалением: см. шапку.
  -- Ноль не пишем — пустая строка в финансах только мешает читать отчёт.
  if v_total > 0 then
    insert into public.finance_records (tenant_id, kind, amount, order_id, note, created_by)
    values (p_tenant_id, 'expense', v_total, p_order_id,
            'повернення №' || v_number::text || ' за замовлення №' || v_order.number::text,
            v_actor);
  end if;

  return v_ret;
end;
$fn$;

comment on function public.create_return(uuid, uuid, text, jsonb) is
  'Возврат от заказа: наследует состав, ограничен проданным минус уже возвращённым, заводит товар на склад журналом и гасит доход встречным расходом. Денег платформа не возвращает.';

-- Правило 7. Три отзыва, потом одна выдача.
revoke all on function public.create_return(uuid, uuid, text, jsonb) from public;
revoke all on function public.create_return(uuid, uuid, text, jsonb) from anon;
revoke all on function public.create_return(uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.create_return(uuid, uuid, text, jsonb) to authenticated;
