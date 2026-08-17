-- 27_returns.sql — возвраты (миграция 0103).
--
-- Возврат трогает две вещи, которые в этом проекте нельзя чинить задним
-- числом: остаток (журнал `stock_movements`) и деньги (`finance_records`).
-- Поэтому проверяется не «функция есть», а то, что после возврата остаток
-- сошёлся с журналом, доход погашен встречной записью, а документ нельзя
-- ни исправить, ни стереть.
--
-- Семь обещаний, каждое отдельной попыткой:
--   1) без причины возврат не заводится;
--   2) вернуть больше проданного нельзя;
--   3) вернуть больше, чем осталось после первого возврата, — тоже нельзя;
--   4) удачный возврат кладёт товар на склад ЖУРНАЛОМ и гасит доход
--      встречным расходом на ту же сумму;
--   5) документ и его состав неизменяемы;
--   6) без `orders.write` нельзя вовсе, без `stock.write` — нельзя, когда
--      в возврате есть товар со складским учётом;
--   7) анониму не открыты ни функция, ни таблицы.
--
-- Файл самодостаточен и обёрнут в транзакцию с откатом.

\set ON_ERROR_STOP on

begin;

grant usage on schema public to anon, authenticated;

create schema if not exists test;
create or replace function test.login(p_user uuid) returns text
language sql as $$
  select set_config('request.jwt.claims',
    (public.custom_access_token_hook(
       jsonb_build_object('user_id', p_user,
                          'claims', jsonb_build_object('sub', p_user))
     ) -> 'claims')::text, false);
$$;

insert into auth.users (id, email) values
  ('27272727-0000-0000-0000-000000000001','ret-owner@test'),
  ('27272727-0000-0000-0000-000000000002','ret-clerk@test');

insert into public.tenants (id, slug, name, kind, status, storefront_enabled,
                            listed_in_catalog, city, modules)
values ('4e4e4e4e-0000-0000-0000-000000000001','ret-shop','ПОВЕРНЕННЯ','both','active',
        true, true, 'ХАРКІВ', enum_range(null::public.tenant_module));

insert into public.tenant_members (tenant_id, user_id, role, permissions) values
  ('4e4e4e4e-0000-0000-0000-000000000001','27272727-0000-0000-0000-000000000001','owner','{}'::jsonb),
  -- Продавец, которому склад НЕ доверен: заказы ведёт, остаток — нет.
  ('4e4e4e4e-0000-0000-0000-000000000001','27272727-0000-0000-0000-000000000002','viewer',
   '{"orders.read": true, "orders.write": true}'::jsonb);

insert into public.offerings (id, tenant_id, kind, status, slug, title, price, listed, published_at)
values ('0ffe0000-0000-0000-0000-000000000001','4e4e4e4e-0000-0000-0000-000000000001',
        'product','active','ret-item','КАНЕКАЛОН',200,true,now());

insert into public.offering_variants (id, tenant_id, offering_id, name, price, track_stock)
values ('7a7a0000-0000-0000-0000-000000000001','4e4e4e4e-0000-0000-0000-000000000001',
        '0ffe0000-0000-0000-0000-000000000001','чорний',200,true);

insert into public.customers (id, tenant_id, name)
values ('c7c70000-0000-0000-0000-000000000001','4e4e4e4e-0000-0000-0000-000000000001','ОКСАНА');

insert into public.orders (id, tenant_id, number, status, customer_id,
                           contact_name, subtotal, total, currency)
values ('a0a00000-0000-0000-0000-000000000001','4e4e4e4e-0000-0000-0000-000000000001',
        1,'paid','c7c70000-0000-0000-0000-000000000001','ОКСАНА',600,600,'UAH');

insert into public.order_items (id, order_id, tenant_id, offering_id, variant_id,
                                title, variant_name, unit_price, quantity)
values ('17e00000-0000-0000-0000-000000000001','a0a00000-0000-0000-0000-000000000001',
        '4e4e4e4e-0000-0000-0000-000000000001','0ffe0000-0000-0000-0000-000000000001',
        '7a7a0000-0000-0000-0000-000000000001','КАНЕКАЛОН','чорний',200,3),
       -- Вторая позиция остаётся невозвращённой: на ней проверяется отказ
       -- по праву склада. На исчерпанной позиции такой отказ не отличить
       -- от «вернули всё» — тест был бы зелёным по неверной причине.
       ('17e00000-0000-0000-0000-000000000002','a0a00000-0000-0000-0000-000000000001',
        '4e4e4e4e-0000-0000-0000-000000000001','0ffe0000-0000-0000-0000-000000000001',
        '7a7a0000-0000-0000-0000-000000000001','КАНЕКАЛОН','білий',200,2);

\set QUIET on
select test.login('27272727-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;

\echo '--- 0103: заводим остаток, чтобы было с чем сравнивать'
select (public.record_stock_movement(
          '4e4e4e4e-0000-0000-0000-000000000001','receipt',10,
          '7a7a0000-0000-0000-0000-000000000001')).quantity as прихід_ожид_10;

select stock_qty as залишок_ожид_10 from public.offering_variants
 where id = '7a7a0000-0000-0000-0000-000000000001';

\echo '--- 0103: возврат без причины не заводится'
do $$
begin
  perform public.create_return(
    '4e4e4e4e-0000-0000-0000-000000000001','a0a00000-0000-0000-0000-000000000001','   ',
    '[{"order_item_id":"17e00000-0000-0000-0000-000000000001","quantity":1}]'::jsonb);
  raise exception 'ПРОВАЛ: повернення без причини';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0103: вернуть больше проданного нельзя'
do $$
begin
  perform public.create_return(
    '4e4e4e4e-0000-0000-0000-000000000001','a0a00000-0000-0000-0000-000000000001','не підійшов',
    '[{"order_item_id":"17e00000-0000-0000-0000-000000000001","quantity":4}]'::jsonb);
  raise exception 'ПРОВАЛ: повернули більше, ніж продали';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0103: возврат двух штук проходит'
select public.create_return(
  '4e4e4e4e-0000-0000-0000-000000000001','a0a00000-0000-0000-0000-000000000001',
  'не підійшов відтінок',
  '[{"order_item_id":"17e00000-0000-0000-0000-000000000001","quantity":2}]'::jsonb) is not null
  as проведено_ожид_t;

\echo '--- 0103: товар лёг на склад ЖУРНАЛОМ, кэш сошёлся'
select (select stock_qty from public.offering_variants
         where id = '7a7a0000-0000-0000-0000-000000000001') as кеш_ожид_12,
       (select coalesce(sum(quantity),0) from public.stock_movements
         where variant_id = '7a7a0000-0000-0000-0000-000000000001') as журнал_ожид_12,
       (select count(*) from public.stock_movements
         where variant_id = '7a7a0000-0000-0000-0000-000000000001'
           and movement_type = 'return') as рухів_повернення_ожид_1;

\echo '--- 0103: доход погашен встречным расходом на ту же сумму'
select kind::text as вид_ожид_expense, amount as сума_ожид_400
  from public.finance_records
 where tenant_id = '4e4e4e4e-0000-0000-0000-000000000001' and kind = 'expense';

\echo '--- 0103: документ получил номер и сумму'
select number as номер_ожид_1, total as сума_ожид_400
  from public.returns where tenant_id = '4e4e4e4e-0000-0000-0000-000000000001';

\echo '--- 0103: третья штука возвращается, четвёртая — нет'
select public.create_return(
  '4e4e4e4e-0000-0000-0000-000000000001','a0a00000-0000-0000-0000-000000000001','залишок',
  '[{"order_item_id":"17e00000-0000-0000-0000-000000000001","quantity":1}]'::jsonb) is not null
  as третя_ожид_t;

do $$
begin
  perform public.create_return(
    '4e4e4e4e-0000-0000-0000-000000000001','a0a00000-0000-0000-0000-000000000001','ще одна',
    '[{"order_item_id":"17e00000-0000-0000-0000-000000000001","quantity":1}]'::jsonb);
  raise exception 'ПРОВАЛ: повернули четверту штуку з трьох проданих';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0103: документ неизменяем — правится только заметка'
-- Роль сбрасывается сознательно. У `authenticated` нет права UPDATE на
-- таблицу вовсе, и отказ пришёл бы от ГРАНТА, а тело сторожа не исполнилось
-- бы ни разу: тест был бы зелёным на пустом триггере. Проверяем вторую
-- линию обороны от роли, которой грант не мешает.
reset role;
do $$
begin
  update public.returns set total = 1
   where tenant_id = '4e4e4e4e-0000-0000-0000-000000000001';
  raise exception 'ПРОВАЛ: суму повернення переписали';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

do $$
begin
  delete from public.returns where tenant_id = '4e4e4e4e-0000-0000-0000-000000000001';
  raise exception 'ПРОВАЛ: повернення стерли';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0103: а заметку править можно'
update public.returns set note = 'домовились із покупцем'
 where tenant_id = '4e4e4e4e-0000-0000-0000-000000000001';
select note as примітка_ожид_є from public.returns
 where tenant_id = '4e4e4e4e-0000-0000-0000-000000000001';

\echo '--- 0103: состав документа не правится вовсе'
do $$
begin
  update public.return_items set quantity = 99
   where tenant_id = '4e4e4e4e-0000-0000-0000-000000000001';
  raise exception 'ПРОВАЛ: склад повернення переписали';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0103: продавец без stock.write возврат товара не проведёт'
\set QUIET on
select test.login('27272727-0000-0000-0000-000000000002');
\set QUIET off
set role authenticated;
do $$
begin
  perform public.create_return(
    '4e4e4e4e-0000-0000-0000-000000000001','a0a00000-0000-0000-0000-000000000001','спроба',
    '[{"order_item_id":"17e00000-0000-0000-0000-000000000002","quantity":1}]'::jsonb);
  raise exception 'ПРОВАЛ: повернення товару без права stock.write';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0103: и прямой вставкой документ не завести'
do $$
declare v_n int;
begin
  insert into public.returns (tenant_id, number, order_id, reason)
  values ('4e4e4e4e-0000-0000-0000-000000000001', 99,
          'a0a00000-0000-0000-0000-000000000001','повз функцію');
  raise exception 'ПРОВАЛ: повернення завели повз create_return';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

reset role;

\echo '--- 0103: анониму не открыты ни функция, ни таблицы'
select has_function_privilege('anon','public.create_return(uuid,uuid,text,jsonb)','EXECUTE')
         as анонім_функція_ожид_f,
       has_table_privilege('anon','public.returns','SELECT') as анонім_читання_ожид_f,
       has_table_privilege('authenticated','public.returns','INSERT') as вошедший_запис_ожид_f,
       has_table_privilege('authenticated','public.returns','SELECT') as вошедший_читання_ожид_t;

rollback;

\echo '--- 27_returns: откат выполнен'
select count(*) as повернень_ожид_0 from public.returns;
