-- 34. Себестоимость из приёмок (0112).
-- Продолжает данные 01/02: заведение aaaa…01, владелец 1111, вариант cccc…01,
-- материал dddd…01. Владелец имеет stock.write.

\set ON_ERROR_STOP on
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off

\echo '=== 34. Собівартість із приймань ==='

\echo '--- первая приёмка С ЦЕНОЙ: себестоимость берётся из строки'
do $$ declare r uuid; c numeric; begin
  -- Материал с чистой себестоимостью, чтобы не зависеть от прогона 02.
  insert into public.materials (id, tenant_id, name, unit)
  values ('34000000-0000-0000-0000-0000000000aa',
          'aaaaaaaa-0000-0000-0000-000000000001', 'Фарба тест-34', 'мл');

  insert into public.stock_receipts (tenant_id, created_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111')
  returning id into r;
  insert into public.stock_receipt_lines (receipt_id, material_id, quantity, unit_cost)
  values (r, '34000000-0000-0000-0000-0000000000aa', 100, 2.00);
  perform public.apply_stock_receipt(r);

  select cost_per_unit into c from public.materials
   where id = '34000000-0000-0000-0000-0000000000aa';
  if c = 2.00 then raise notice 'ок: собівартість 2.00';
  else raise exception 'ПРОВАЛ: собівартість %, чекали 2.00', c; end if;
end $$;

\echo '--- вторая приёмка по другой цене: средневзвешенная, а не «последняя победила»'
do $$ declare r uuid; c numeric; begin
  insert into public.stock_receipts (tenant_id, created_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111')
  returning id into r;
  -- Было 100 мл по 2.00; приходит 100 мл по 4.00 → (200+400)/200 = 3.00.
  insert into public.stock_receipt_lines (receipt_id, material_id, quantity, unit_cost)
  values (r, '34000000-0000-0000-0000-0000000000aa', 100, 4.00);
  perform public.apply_stock_receipt(r);

  select cost_per_unit into c from public.materials
   where id = '34000000-0000-0000-0000-0000000000aa';
  if c = 3.00 then raise notice 'ок: середньозважена 3.00';
  else raise exception 'ПРОВАЛ: собівартість %, чекали 3.00', c; end if;
end $$;

\echo '--- ГЛАВНОЕ: приёмка БЕЗ цены себестоимость не трогает'
do $$ declare r uuid; c numeric; begin
  insert into public.stock_receipts (tenant_id, created_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111')
  returning id into r;
  insert into public.stock_receipt_lines (receipt_id, material_id, quantity)
  values (r, '34000000-0000-0000-0000-0000000000aa', 50);
  perform public.apply_stock_receipt(r);

  select cost_per_unit into c from public.materials
   where id = '34000000-0000-0000-0000-0000000000aa';
  if c = 3.00 then raise notice 'ок: без ціни собівартість не змінилася';
  else raise exception 'ПРОВАЛ: собівартість стала %, чекали 3.00', c; end if;
end $$;

\echo '--- остаток после трёх приёмок сходится с журналом'
select case
         when m.current_stock = 250
          and m.current_stock = (select coalesce(sum(quantity), 0)
                                   from public.stock_movements
                                  where material_id = m.id)
         then 'ок'
         else 'ПРОВАЛ: кеш ' || m.current_stock end as проверка
  from public.materials m
 where m.id = '34000000-0000-0000-0000-0000000000aa';
