-- 03_orders.sql — заказы, гостевая покупка, финансы.
-- Продолжает данные 01/02: магазин shop-one, вариант M (остаток 8,
-- резерв 8 от теста 02), оператор и владелец.

\set ON_ERROR_STOP on

-- Подготовка: оператор освобождает старый резерв из теста 02
\set QUIET on
select test.login('22222222-2222-2222-2222-222222222222');
\set QUIET off

\echo '--- подготовка: освобождаем резерв из 02, публикуем витрину'
select (public.release_reservation(r.id)).status as статус_ожид_released
  from public.stock_reservations r
 where r.status = 'active' limit 1;

update public.tenants set storefront_enabled = true
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';

select stock_qty, reserved_qty from public.offering_variants
 where id = 'cccccccc-0000-0000-0000-000000000001';

-- ГОСТЬ: без аккаунта, только имя и телефон
\set QUIET on
select set_config('request.jwt.claims', '{}', false);
\set QUIET off
set role anon;

\echo '--- гость оформляет заказ на 2 шт: номер 1, цена из базы'
select o.number as номер_ожид_1, o.total as итог_ожид_6000, o.status,
       o.contact_name
  from public.create_order(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '[{"variant_id":"cccccccc-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
    'Ірина Гість', '+380501112233', null,
    '{"method":"nova_poshta","city":"Харків","branch":"47"}'::jsonb
  ) o;

\echo '--- резерв удержан под заказ гостя'
reset role;
select stock_qty, reserved_qty as резерв_ожид_2 from public.offering_variants
 where id = 'cccccccc-0000-0000-0000-000000000001';

\echo '--- гость через API не видит ни заказов, ни клиентов'
set role anon;
select (select count(*) from public.orders)    as заказов_ожид_0,
       (select count(*) from public.customers) as клиентов_ожид_0;

\echo '--- второй гостевой заказ: номер 2, тот же телефон = тот же клиент'
select o.number as номер_ожид_2 from public.create_order(
  'aaaaaaaa-0000-0000-0000-000000000001',
  '[{"variant_id":"cccccccc-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
  'Ірина Гість', '+380501112233'
) o;

reset role;
\echo '--- клиент один, заказов у него два (кэш карточки)'
select count(*) as карточек_ожид_1 from public.customers;
select orders_count as заказов_ожид_2, total_spent as потрачено_ожид_0
  from public.customers limit 1;

\echo '--- отслеживание без входа: номер + телефон'
set role anon;
select status as найден_ожид_new from public.track_order('shop-one', 1, '+380501112233');
select count(*) as чужой_телефон_ожид_0
  from public.track_order('shop-one', 1, '+380509999999');
reset role;

-- ПРОДАВЕЦ
\set QUIET on
select test.login('22222222-2222-2222-2222-222222222222');
\set QUIET off

\echo '--- запрещённый переход new → delivered обязан упасть'
do $$ declare v_id uuid; begin
  select id into v_id from public.orders where number = 2;
  perform public.set_order_status(v_id, 'delivered');
  raise exception 'ПРОВАЛ: прыжок через статусы прошёл';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- прямая правка итога заказа обязана упасть'
do $$ begin
  update public.orders set total = 1 where number = 2;
  raise exception 'ПРОВАЛ: итог поправили рукой';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- цепочка №2: confirmed → paid; доход появляется ровно один'
do $$ declare v_id uuid; begin
  select id into v_id from public.orders where number = 2;
  perform public.set_order_status(v_id, 'confirmed');
  perform public.set_order_status(v_id, 'paid');
end $$;

select count(*) as доходов_ожид_1, min(amount) as сумма_ожид_3000
  from public.finance_records where kind = 'income';

-- Дальше работаем с деньгами от имени ВЛАДЕЛЬЦА: у кладовщика нет
-- finances.write, и его отказ был бы отказом прав, а не проверкой запрета.
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off

\echo '--- вторая запись дохода на тот же заказ обязана упасть'
do $$ declare v_id uuid; begin
  select id into v_id from public.orders where number = 2;
  insert into public.finance_records (tenant_id, kind, amount, order_id, created_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'income', 3000, v_id,
          '11111111-1111-1111-1111-111111111111');
  raise exception 'ПРОВАЛ: доход задвоился';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- правка суммы финансовой записи обязана упасть'
do $$ begin
  update public.finance_records set amount = 9999 where kind = 'income';
  raise exception 'ПРОВАЛ: сумму дохода поправили задним числом';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- удаление финансовой записи обязано упасть'
do $$ begin
  delete from public.finance_records where kind = 'income';
  raise exception 'ПРОВАЛ: запись о деньгах удалилась';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- отмена заказа №1 освобождает его резерв (2 шт)'
\set QUIET on
select test.login('22222222-2222-2222-2222-222222222222');
\set QUIET off
do $$ declare v_id uuid; begin
  select id into v_id from public.orders where number = 1;
  perform public.set_order_status(v_id, 'cancelled', 'клиент передумал');
end $$;

select reserved_qty as резерв_ожид_1 from public.offering_variants
 where id = 'cccccccc-0000-0000-0000-000000000001';

\echo '--- история заказа №2 записана сама: new → confirmed → paid'
select from_status, to_status from public.order_events e
  join public.orders o on o.id = e.order_id
 where o.number = 2 order by e.created_at;

\echo '--- кэш клиента после оплаты и отмены: 1 живой заказ, потрачено 3000'
select orders_count as заказов_ожид_1, total_spent as потрачено_ожид_3000
  from public.customers limit 1;

\echo '--- скрытая позиция гостю не продаётся'
update public.offerings set status = 'hidden'
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
\set QUIET on
select set_config('request.jwt.claims', '{}', false);
\set QUIET off
set role anon;
do $$ begin
  perform public.create_order(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '[{"variant_id":"cccccccc-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
    'Хтось');
  raise exception 'ПРОВАЛ: скрытое продалось гостю';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;
reset role;
update public.offerings set status = 'active'
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';

\echo '--- кладовщик (operator) не видит финансы даже напрямую'
\set QUIET on
select test.login('22222222-2222-2222-2222-222222222222');
\set QUIET off
set role authenticated;
select count(*) as финзаписей_видно_ожид_0 from public.finance_records;
reset role;

\echo '--- отчёты склада не показывают чужой магазин даже вошедшему (0029)'
-- Витрина здесь уже опубликована (см. начало файла), а значит
-- offering_variants намеренно читаются шире одного арендатора — иначе
-- не работает каталог. Ровно на этом и текли два представления склада:
-- security_invoker наследовал ширину таблицы, и любой зарегистрированный
-- человек собирал одним запросом себестоимость и остатки ВСЕХ магазинов
-- площадки. 0013 закрыл это только от анонима.
select test.login('33333333-3333-3333-3333-333333333333') is not null as вошли_стороннім;
do $$
declare v_value int; v_low int;
begin
  select count(*) into v_value from public.stock_value_view;
  select count(*) into v_low   from public.stock_low_view;
  if v_value > 0 then
    raise exception 'ПРОВАЛ: stock_value_view віддав % рядків сторонньому — витік собівартості', v_value;
  end if;
  if v_low > 0 then
    raise exception 'ПРОВАЛ: stock_low_view віддав % рядків сторонньому — видно, що закінчується у сусіда', v_low;
  end if;
  raise notice 'ok — обидва звіти складу порожні для стороннього';
end $$;

\echo '--- и при этом свой магазин в отчёте виден (фильтр не пересолен)'
select test.login('11111111-1111-1111-1111-111111111111') is not null as вошли_власником;
do $$
declare v_value int;
begin
  select count(*) into v_value from public.stock_value_view;
  if v_value = 0 then
    raise exception 'ПРОВАЛ: власник не бачить власного складу — фільтр 0029 надто вузький';
  end if;
  raise notice 'ok — власник бачить свій склад (% рядків)', v_value;
end $$;
