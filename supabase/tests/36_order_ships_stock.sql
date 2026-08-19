-- 36. Отгрузка заказа списывает остаток; резервы истекают (0114).
-- Продолжает данные 01: заведение aaaa…01, владелец 1111 (orders.write,
-- stock.write), оффер bbbb…01.

\set ON_ERROR_STOP on
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off

\echo '=== 36. Відвантаження списує; резерви спливають ==='

\set QUIET on
insert into public.offering_variants (id, tenant_id, offering_id, name, price, track_stock)
values ('36000000-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000001', 'Розмір 36', 500, true);
select public.record_stock_movement(
  'aaaaaaaa-0000-0000-0000-000000000001', 'receipt', 10,
  '36000000-0000-0000-0000-000000000001');
\set QUIET off

\echo '--- заказ на 2 шт: резерв удержан'
do $$ declare o public.orders; s int; r int; begin
  select * into o from public.create_order(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '[{"variant_id":"36000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
    'Тест 36', '+380500000036');
  select stock_qty, reserved_qty into s, r from public.offering_variants
   where id = '36000000-0000-0000-0000-000000000001';
  if s = 10 and r = 2 then raise notice 'ок: 10 на складі, 2 у резерві';
  else raise exception 'ПРОВАЛ: склад %, резерв %', s, r; end if;

  perform public.set_order_status(o.id, 'confirmed');
  perform public.set_order_status(o.id, 'packing');
  perform public.set_order_status(o.id, 'shipped');
end $$;

\echo '--- ГЛАВНОЕ: после отгрузки остаток списан, резерв снят, продажа в журнале'
do $$ declare s int; r int; n int; st text; begin
  select stock_qty, reserved_qty into s, r from public.offering_variants
   where id = '36000000-0000-0000-0000-000000000001';
  select count(*) into n from public.stock_movements
   where variant_id = '36000000-0000-0000-0000-000000000001'
     and movement_type = 'sale' and quantity = -2;
  select status into st from public.stock_reservations
   where variant_id = '36000000-0000-0000-0000-000000000001'
   order by created_at desc limit 1;
  if s = 8 and r = 0 and n = 1 and st = 'committed'
  then raise notice 'ок: 8 на складі, резерв знято, рух sale записано, резерв committed';
  else raise exception 'ПРОВАЛ: склад %, резерв %, рухів sale %, статус %', s, r, n, st; end if;
end $$;

\echo '--- кэш остатка сходится с журналом'
select case when v.stock_qty = (select sum(quantity) from public.stock_movements
                                 where variant_id = v.id)
       then 'ок' else 'ПРОВАЛ: кеш розійшовся' end as проверка
  from public.offering_variants v
 where v.id = '36000000-0000-0000-0000-000000000001';

\echo '--- просроченный резерв гасится, товар снова доступен'
do $$ declare o public.orders; r int; n int; begin
  select * into o from public.create_order(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '[{"variant_id":"36000000-0000-0000-0000-000000000001","quantity":3}]'::jsonb,
    'Тест 36-2', '+380500000037');
  update public.stock_reservations set expires_at = now() - interval '1 hour'
   where reference_id = o.id;

  select public.expire_stale_reservations() into n;
  select reserved_qty into r from public.offering_variants
   where id = '36000000-0000-0000-0000-000000000001';
  if n >= 1 and r = 0 then raise notice 'ок: резерв погашено (%), доступність повернулася', n;
  else raise exception 'ПРОВАЛ: погашено %, резерв %', n, r; end if;

  -- Отгрузка заказа с истёкшим резервом всё равно списывает — ветка
  -- «без резерву»: факт отгрузки первичен.
  perform public.set_order_status(o.id, 'confirmed');
  perform public.set_order_status(o.id, 'packing');
  perform public.set_order_status(o.id, 'shipped');
end $$;

\echo '--- отгрузка без резерва списала прямым движением'
do $$ declare s int; n int; begin
  select stock_qty into s from public.offering_variants
   where id = '36000000-0000-0000-0000-000000000001';
  select count(*) into n from public.stock_movements
   where variant_id = '36000000-0000-0000-0000-000000000001'
     and movement_type = 'sale' and note like '%без резерву%';
  if s = 5 and n = 1 then raise notice 'ок: 5 на складі, рух «без резерву» один';
  else raise exception 'ПРОВАЛ: склад %, рухів без резерву %', s, n; end if;
end $$;

\echo '--- отмена до отгрузки по-прежнему возвращает резерв'
do $$ declare o public.orders; r int; s int; begin
  select * into o from public.create_order(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '[{"variant_id":"36000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
    'Тест 36-3', '+380500000038');
  perform public.set_order_status(o.id, 'cancelled', 'передумав');
  select stock_qty, reserved_qty into s, r from public.offering_variants
   where id = '36000000-0000-0000-0000-000000000001';
  if s = 5 and r = 0 then raise notice 'ок: скасування зняло резерв, залишок цілий';
  else raise exception 'ПРОВАЛ: склад %, резерв %', s, r; end if;
end $$;
