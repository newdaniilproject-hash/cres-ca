-- 02_stock.sql — склад. Проверяются в первую очередь запреты:
-- сценарий, который ДОЛЖЕН упасть, обязан упасть.
-- Продолжает данные из 01_permissions.sql.

\set ON_ERROR_STOP on
\set QUIET on
select test.login('22222222-2222-2222-2222-222222222222');
\set QUIET off

\echo '--- прямая правка остатка в обход журнала обязана упасть'
do $$ begin
  update public.offering_variants set stock_qty = 999
   where id = 'cccccccc-0000-0000-0000-000000000001';
  raise exception 'ПРОВАЛ: прямая правка остатка прошла';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- приёмка документом: 10 шт товара и 20 катушек ниток одной транзакцией'
do $$ declare r uuid; sup uuid; begin
  insert into public.suppliers (tenant_id, name)
       values ('aaaaaaaa-0000-0000-0000-000000000001','Постачальник ТОВ')
    returning id into sup;
  insert into public.stock_receipts (tenant_id, supplier_id, created_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001', sup,
          '22222222-2222-2222-2222-222222222222')
  returning id into r;
  insert into public.stock_receipt_lines (receipt_id, variant_id,  quantity) values (r,'cccccccc-0000-0000-0000-000000000001',10);
  insert into public.stock_receipt_lines (receipt_id, material_id, quantity) values (r,'dddddddd-0000-0000-0000-000000000001',20);
  perform public.apply_stock_receipt(r);
end $$;

select * from test.check_ledger('после приёмки');

\echo '--- повторная проводка того же документа обязана упасть'
do $$ declare r uuid; begin
  select id into r from public.stock_receipts limit 1;
  perform public.apply_stock_receipt(r);
  raise exception 'ПРОВАЛ: документ провёлся дважды';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- резерв 8 из 10, затем попытка забрать ещё 5 обязана упасть'
select (public.reserve_stock('aaaaaaaa-0000-0000-0000-000000000001',
  'cccccccc-0000-0000-0000-000000000001', 8, 'order',
  '99999999-0000-0000-0000-000000000001')).quantity as зарезервировано;

select stock_qty, reserved_qty, public.variant_available(v.*) as доступно_ожид_2
  from public.offering_variants v where id='cccccccc-0000-0000-0000-000000000001';

do $$ begin
  perform public.reserve_stock('aaaaaaaa-0000-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000001', 5, 'order', gen_random_uuid());
  raise exception 'ПРОВАЛ: перепродажа прошла';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- списание расходников по рецепту: 3 катушки на единицу, 2 единицы'
select count(*) as движений from public.consume_materials_for_variant(
  'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',
  2, 'order', '99999999-0000-0000-0000-000000000001');
select current_stock as ниток_ожид_14 from public.materials;

\echo '--- повтор с тем же ключом идемпотентности не двигает остаток дважды'
select (public.record_stock_movement('aaaaaaaa-0000-0000-0000-000000000001','write_off',-1,
  'cccccccc-0000-0000-0000-000000000001',null,null,null,null,null,'брак','webhook-42')).id as первый;
select (public.record_stock_movement('aaaaaaaa-0000-0000-0000-000000000001','write_off',-1,
  'cccccccc-0000-0000-0000-000000000001',null,null,null,null,null,'брак','webhook-42')).id as повтор_тот_же_id;
select count(*) as движений_ожид_1 from public.stock_movements where idempotency_key = 'webhook-42';
select * from test.check_ledger('после повтора');

\echo '--- приёмка с отрицательным количеством обязана упасть'
do $$ begin
  perform public.record_stock_movement('aaaaaaaa-0000-0000-0000-000000000001','receipt',-5,
    'cccccccc-0000-0000-0000-000000000001');
  raise exception 'ПРОВАЛ: приёмка с минусом прошла';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- инвентаризация: по факту 8 вместо 9, расхождение закрывается движением'
do $$ declare c record; begin
  c := public.start_stock_count('aaaaaaaa-0000-0000-0000-000000000001',
        array['cccccccc-0000-0000-0000-000000000001']::uuid[]);
  update public.stock_count_lines set counted_qty = 8 where count_id = c.id;
  perform public.apply_stock_count(c.id);
end $$;

select * from test.check_ledger('после инвентаризации');

\echo '--- ЗАДАНИЕ 01: consume_materials_for_variant не берёт чужую рецептуру (0030)'
-- Второй арендатор — чтобы «чужой вариант» был настоящим чужим, а не выдумкой.
-- Оператор 2222 состоит только в первом и имеет там stock.write; во втором
-- у него прав нет вовсе.
insert into public.tenants (id, slug, name, status)
values ('aaaaaaaa-0000-0000-0000-000000000091','shop-guard','Магазин 2','active')
on conflict (id) do nothing;

insert into public.offerings (id, tenant_id, kind, status, slug, title, price)
values ('bbbbbbbb-0000-0000-0000-000000000091','aaaaaaaa-0000-0000-0000-000000000091',
        'product','active','chuzhe-guard','Чуже пальто', 100)
on conflict (id) do nothing;

insert into public.offering_variants (id, tenant_id, offering_id, name, price)
values ('cccccccc-0000-0000-0000-000000000091','aaaaaaaa-0000-0000-0000-000000000091',
        'bbbbbbbb-0000-0000-0000-000000000091','Чужий M', 100)
on conflict (id) do nothing;

-- Вариант СВОЕГО арендатора с ПУСТОЙ рецептурой: на нём проверяется вторая
-- дыра — при пустом цикле record_stock_movement не звался ни разу, и прав
-- не проверял никто.
insert into public.offering_variants (id, tenant_id, offering_id, name, price)
values ('cccccccc-0000-0000-0000-000000000092','aaaaaaaa-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000001','Без рецептури', 50)
on conflict (id) do nothing;

select test.login('22222222-2222-2222-2222-222222222222');

\echo '    1) свой вариант со своей рецептурой — списывает как раньше'
do $$ declare n int; begin
  select count(*) into n from public.consume_materials_for_variant(
    'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',
    1, 'booking', null, 'тест 0030');
  if n <> 1 then raise exception 'ПРОВАЛ: своя рецептура дала % движений вместо 1', n; end if;
  raise notice 'ok — своя рецептура списалась (% рух)', n;
end $$;

\echo '    2) ЧУЖОЙ вариант обязан упасть (до 0030 — молча списывал своё)'
do $$ begin
  perform public.consume_materials_for_variant(
    'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000091',
    1, 'booking', null, null);
  raise exception 'ПРОВАЛ: списание по ЧУЖОЙ рецептуре прошло';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '    3) без stock.write и с пустой рецептурой обязано упасть (до 0030 — тихий успех)'
select test.login('33333333-3333-3333-3333-333333333333');
do $$ begin
  perform public.consume_materials_for_variant(
    'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000092',
    1, 'booking', null, null);
  raise exception 'ПРОВАЛ: посторонний списал при пустой рецептуре';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

select test.login('22222222-2222-2222-2222-222222222222');

\echo '--- ЗАХОД 1: остаток нельзя СОЗДАТЬ вставкой строки (0031)'
-- До 0031 охранники стояли только на UPDATE, и остаток заводился из воздуха:
-- кэш расходился с журналом навсегда, потому что гасить встречным движением
-- было нечего — движения не было.
select test.login('22222222-2222-2222-2222-222222222222');

do $$ begin
  insert into public.materials (id, tenant_id, name, unit, current_stock)
  values ('dddddddd-0000-0000-0000-000000000091','aaaaaaaa-0000-0000-0000-000000000001',
          'Остаток из воздуха','кг', 500);
  raise exception 'ПРОВАЛ: расходник заведён с ненулевым остатком';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

do $$ begin
  insert into public.offering_variants (id, tenant_id, offering_id, name, price, stock_qty)
  values ('cccccccc-0000-0000-0000-000000000093','aaaaaaaa-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-000000000001','Из воздуха', 100, 999);
  raise exception 'ПРОВАЛ: позиция заведена с ненулевым остатком';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '    и при этом обычное заведение с нулём проходит'
do $$ begin
  insert into public.materials (id, tenant_id, name, unit)
  values ('dddddddd-0000-0000-0000-000000000092','aaaaaaaa-0000-0000-0000-000000000001',
          'Нормальный расходник','кг');
  raise notice 'ok — расходник с нулевым остатком заводится';
exception when others then
  raise exception 'ПРОВАЛ: обычное заведение расходника сломано — %', sqlerrm; end $$;
