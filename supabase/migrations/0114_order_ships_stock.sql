-- 0114. Отгрузка заказа списывает остаток. Резервы истекают.
--
-- ── В чём была дыра ─────────────────────────────────────────────────────────
--
-- Найдено сверкой 19.08.2026: `commit_reservation` лежала в 0003 МЁРТВОЙ —
-- её не звал никто. Оформление заказа резервировало товар
-- (`reserve_stock_internal` внутри `create_order`), отмена снимала резерв,
-- а ВЫПОЛНЕНИЕ не делало ничего: ни движения 'sale' в журнале, ни снятия
-- резерва, ни уменьшения остатка. Продажа не списывала товар НИКОГДА.
--
-- Хуже: возврат (0103) кладёт товар НА склад движением 'return'. Продать
-- и принять назад означало +1 к остатку из воздуха. Фильтр «продаж»
-- в журнале движений был вечно пуст — тип 'sale' не писал никто.
--
-- И вторая половина той же дыры: `expires_at` у резерва ставится при
-- оформлении (`now() + p_reserve_hours`), статус 'expired' есть в enum,
-- индекс по сроку есть — а ничто и никогда резерв не гасило. Брошенный
-- гостевой заказ держал товар недоступным на витрине НАВСЕГДА.
--
-- ── Что делает ──────────────────────────────────────────────────────────────
--
-- 1. Переход заказа в 'shipped' («передано перевізнику») превращает резервы
--    строк в движения 'sale' через `commit_reservation` — момент, когда
--    товар физически покидает полку. Не 'completed': к завершению заказа
--    товар давно уехал, и списывать его позже значит неделю показывать
--    на витрине то, чего нет.
-- 2. Строка, у которой резерв уже истёк (или заказ старый, до-резервный),
--    списывается прямым движением 'sale' — факт отгрузки первичен, а его
--    отсутствие в журнале хуже честного минуса в остатке.
-- 3. `expire_stale_reservations()` раз в 15 минут гасит просроченные
--    резервы: статус 'expired', `reserved_qty` вниз, товар снова доступен.
--
-- ── Чего НЕ делает — названо, а не забыто ───────────────────────────────────
--
-- Отмена и возврат по-прежнему освобождают резерв ВСТРОЕННЫМ кодом, а не
-- `release_reservation`: та функция требует `orders.write`, а отменить
-- СВОЙ ранний заказ может и покупатель без всяких прав. Звать её отсюда
-- значило бы сломать покупательскую отмену; двойная запись логики здесь
-- осознанная и помечена в обоих местах.
--
-- `create or replace` поверх 0006: действующее тело прочитано целиком,
-- всё нетронутое перенесено дословно.

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
  v_res   public.stock_reservations;
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

  -- Отгрузка списывает: резерв строки становится продажей. Сюда попадает
  -- только продавец — покупательская ветка выше пускает лишь 'cancelled'.
  if p_status = 'shipped' then
    for v_item in
      select oi.variant_id, oi.quantity, oi.reservation_id, v.track_stock
        from public.order_items oi
        join public.offering_variants v on v.id = oi.variant_id
       where oi.order_id = p_order_id
    loop
      v_res := null;
      if v_item.reservation_id is not null then
        select * into v_res from public.stock_reservations
         where id = v_item.reservation_id and status = 'active';
      end if;

      if v_res.id is not null then
        perform public.commit_reservation(
          v_res.id, format('відвантаження замовлення №%s', v_order.number));
      elsif v_item.track_stock then
        -- Резерв истёк или его не было (старый заказ): отгрузка всё равно
        -- случилась, и журнал обязан её знать. Минус в остатке честнее
        -- молчания — его видно, и он чинится инвентаризацией.
        perform public.record_stock_movement(
          p_tenant_id      => v_order.tenant_id,
          p_movement_type  => 'sale',
          p_quantity       => -v_item.quantity,
          p_variant_id     => v_item.variant_id,
          p_reference_type => 'order',
          p_reference_id   => p_order_id,
          p_note           => format('відвантаження замовлення №%s (без резерву)', v_order.number));
      end if;
    end loop;
  end if;

  -- Отмена и возврат освобождают резервы строк заказа.
  -- НЕ через release_reservation: см. шапку файла.
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

revoke execute on function public.set_order_status(uuid, public.order_status, text) from public;
revoke execute on function public.set_order_status(uuid, public.order_status, text) from anon;
grant  execute on function public.set_order_status(uuid, public.order_status, text) to authenticated;

-- ── Просроченные резервы ────────────────────────────────────────────────────
--
-- Гасит резервы, чей срок вышел: 'expired' + возврат reserved_qty. Товар
-- снова продаётся на витрине; сам заказ живёт — при отгрузке такой строки
-- сработает ветка «без резерву» выше.
--
-- security definer и БЕЗ проверки прав намеренно: функцию зовёт планировщик
-- pg_cron под postgres, а не человек. EXECUTE отозван у всех клиентских
-- ролей — снаружи её не дёрнуть.
create or replace function public.expire_stale_reservations()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res record;
  v_n   int := 0;
begin
  for v_res in
    select id, variant_id, quantity from public.stock_reservations
     where status = 'active' and expires_at is not null and expires_at < now()
     for update skip locked
  loop
    update public.stock_reservations set status = 'expired' where id = v_res.id;
    perform set_config('vitrina.allow_stock_write', 'on', true);
    update public.offering_variants
       set reserved_qty = greatest(reserved_qty - v_res.quantity, 0)
     where id = v_res.variant_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.expire_stale_reservations() from public;
revoke execute on function public.expire_stale_reservations() from anon;
revoke execute on function public.expire_stale_reservations() from authenticated;

-- Раз в 15 минут: точность «плюс-минус четверть часа» для суточного
-- удержания достаточна, а чаще — лишние пробуждения базы.
select cron.schedule(
  'expire-stale-reservations',
  '*/15 * * * *',
  $$ select public.expire_stale_reservations(); $$
);
