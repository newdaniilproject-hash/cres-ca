-- 35. Перемещение в другое место хранения (0113).
-- Продолжает данные 01/34: заведение aaaa…01, владелец 1111 (stock.write),
-- оператор 2222 (без stock.write), материал 34…aa с остатком 250.

\set ON_ERROR_STOP on
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off

\echo '=== 35. Переміщення між місцями зберігання ==='

\set QUIET on
insert into public.storage_locations (id, tenant_id, name)
values ('35000000-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001', 'Полиця 35-А'),
       ('35000000-0000-0000-0000-000000000002',
        'aaaaaaaa-0000-0000-0000-000000000001', 'Шафа 35-Б');
\set QUIET off

\echo '--- перенос пишет ПАРУ движений и меняет место'
do $$ declare n int; loc uuid; s numeric; begin
  perform public.relocate_stock(
    p_material_id => '34000000-0000-0000-0000-0000000000aa',
    p_location_id => '35000000-0000-0000-0000-000000000001');

  select location_id, current_stock into loc, s from public.materials
   where id = '34000000-0000-0000-0000-0000000000aa';
  select count(*) into n from public.stock_movements
   where material_id = '34000000-0000-0000-0000-0000000000aa'
     and movement_type in ('transfer_out', 'transfer_in');

  if loc = '35000000-0000-0000-0000-000000000001' and n = 2 and s = 250
  then raise notice 'ок: місце змінено, пара рухів у журналі, залишок не рушив';
  else raise exception 'ПРОВАЛ: місце %, рухів %, залишок %', loc, n, s; end if;
end $$;

\echo '--- перенос в то же место обязан упасть'
do $$ begin
  perform public.relocate_stock(
    p_material_id => '34000000-0000-0000-0000-0000000000aa',
    p_location_id => '35000000-0000-0000-0000-000000000001');
  raise exception 'ПРОВАЛ: перенесли туди, де вже лежить';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ок — %', sqlerrm; end $$;

\echo '--- ГЛАВНОЕ: чужое место хранения не принимается'
do $$ declare loc uuid; begin
  -- Чужое заведение — своё, у общих фикстур второго арендатора нет.
  insert into public.tenants (id, slug, name, status)
  values ('35000000-0000-0000-0000-0000000000dd', 'shop-35', 'Чужий магазин 35', 'active');
  insert into public.storage_locations (id, tenant_id, name)
  values ('35000000-0000-0000-0000-00000000000f',
          '35000000-0000-0000-0000-0000000000dd', 'Чужа полиця')
  returning id into loc;
  perform public.relocate_stock(
    p_material_id => '34000000-0000-0000-0000-0000000000aa',
    p_location_id => loc);
  raise exception 'ПРОВАЛ: позиція переїхала в чуже заведення';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ок — %', sqlerrm; end $$;

\echo '--- ГЛАВНОЕ: без stock.write перенос обязан упасть'
\set QUIET on
select test.login('22222222-2222-2222-2222-222222222222');
\set QUIET off
do $$ begin
  perform public.relocate_stock(
    p_material_id => '34000000-0000-0000-0000-0000000000aa',
    p_location_id => '35000000-0000-0000-0000-000000000002');
  raise exception 'ПРОВАЛ: оператор без stock.write переніс позицію';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ок — %', sqlerrm; end $$;

\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off

\echo '--- нулевой остаток: место меняется, журнал не трогается'
do $$ declare n int; loc uuid; begin
  insert into public.materials (id, tenant_id, name, unit, location_id)
  values ('35000000-0000-0000-0000-0000000000aa',
          'aaaaaaaa-0000-0000-0000-000000000001', 'Порожній засіб 35', 'шт',
          '35000000-0000-0000-0000-000000000001');
  perform public.relocate_stock(
    p_material_id => '35000000-0000-0000-0000-0000000000aa',
    p_location_id => '35000000-0000-0000-0000-000000000002');
  select location_id into loc from public.materials
   where id = '35000000-0000-0000-0000-0000000000aa';
  select count(*) into n from public.stock_movements
   where material_id = '35000000-0000-0000-0000-0000000000aa';
  if loc = '35000000-0000-0000-0000-000000000002' and n = 0
  then raise notice 'ок: нуль перенесено без рухів';
  else raise exception 'ПРОВАЛ: місце %, рухів %', loc, n; end if;
end $$;

\echo '--- «прибрати з місця»: null принимается и след остаётся'
do $$ declare n int; loc uuid; begin
  perform public.relocate_stock(
    p_material_id => '34000000-0000-0000-0000-0000000000aa',
    p_location_id => null);
  select location_id into loc from public.materials
   where id = '34000000-0000-0000-0000-0000000000aa';
  select count(*) into n from public.stock_movements
   where material_id = '34000000-0000-0000-0000-0000000000aa'
     and movement_type in ('transfer_out', 'transfer_in');
  if loc is null and n = 4
  then raise notice 'ок: місце знято, у журналі друга пара';
  else raise exception 'ПРОВАЛ: місце %, рухів %', loc, n; end if;
end $$;
