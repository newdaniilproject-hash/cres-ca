-- 08_stock_plus.sql — склад после 0066 и 0067.
--
-- Проверяется поведение, а не наличие колонок: что теперь МОЖНО
-- (пересчитать расходники) и чего по-прежнему НЕЛЬЗЯ (переписать
-- журнал движений и проведённую накладную). Продолжает данные 01–07.

\set ON_ERROR_STOP on
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;

\echo '--- 0066: инвентаризация РАСХОДНИКОВ проходит полный цикл'

-- Остаток расходника до пересчёта берём из кэша: он и есть «ожидаемое».
select current_stock as остаток_до
  from public.materials where id = 'dddddddd-0000-0000-0000-000000000001';

-- Берём именно .id: у составного типа «IS NOT NULL» истинно только когда
-- НИ ОДНО поле не пусто, а applied_at у начатого пересчёта пуст по смыслу.
select (public.start_stock_count(
  'aaaaaaaa-0000-0000-0000-000000000001',
  null,
  array['dddddddd-0000-0000-0000-000000000001'::uuid]
)).id is not null as пересчёт_почався_ожид_t;

-- Считаем на две единицы больше, чем ждали: недостача наоборот, излишек.
update public.stock_count_lines
   set counted_qty = expected_qty + 2
 where count_id = (select id from public.stock_counts
                    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                    order by started_at desc limit 1)
   and material_id = 'dddddddd-0000-0000-0000-000000000001';

select (public.apply_stock_count(
  (select id from public.stock_counts
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    order by started_at desc limit 1)
)).status as статус_ожид_applied;

\echo '--- расхождение разнесено ДВИЖЕНИЕМ, а не правкой остатка'
select movement_type as тип_ожид_adjustment, quantity as кількість_ожид_2
  from public.stock_movements
 where material_id = 'dddddddd-0000-0000-0000-000000000001'
   and reference_type = 'stock_count'
 order by created_at desc limit 1;

\echo '--- остаток сошёлся с журналом'
select (m.current_stock = (select coalesce(sum(quantity), 0)
                             from public.stock_movements sm
                            where sm.material_id = m.id)) as кеш_дорівнює_журналу_ожид_t
  from public.materials m where m.id = 'dddddddd-0000-0000-0000-000000000001';

reset role;

\echo '--- 0066: одну позицию нельзя посчитать в одном документе дважды'
--
-- Проверяем МИМО RLS: политики INSERT у stock_count_lines нет вовсе,
-- и под обычной ролью запрос не доходит до ограничения таблицы.
-- А защищать целостность документа обязано именно ограничение —
-- строки туда пишет функция start_stock_count, идущая мимо политик.
do $$
declare v_count uuid;
begin
  select id into v_count from public.stock_counts
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   order by started_at desc limit 1;
  insert into public.stock_count_lines (count_id, material_id, expected_qty)
  values (v_count, 'dddddddd-0000-0000-0000-000000000001', 0);
  raise exception 'ПРОВАЛ: расходник попал в один пересчёт дважды';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- 0066: строка пересчёта без цели и с двумя целями сразу отбивается'
do $$
declare v_count uuid;
begin
  select id into v_count from public.stock_counts
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   order by started_at desc limit 1;
  insert into public.stock_count_lines (count_id, expected_qty) values (v_count, 1);
  raise exception 'ПРОВАЛ: строка пересчёта завелась без товара і без засоба';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

do $$
declare v_count uuid;
begin
  select id into v_count from public.stock_counts
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   order by started_at desc limit 1;
  insert into public.stock_count_lines (count_id, variant_id, material_id, expected_qty)
  values (v_count, 'cccccccc-0000-0000-0000-000000000001',
          'dddddddd-0000-0000-0000-000000000001', 1);
  raise exception 'ПРОВАЛ: строка пересчёта указала сразу и товар, и засіб';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

set role authenticated;

\echo '--- 0066: пустой пересчёт не заводится'
do $$ begin
  perform public.start_stock_count('aaaaaaaa-0000-0000-0000-000000000001', null, null);
  raise exception 'ПРОВАЛ: завёлся пересчёт без единой позиции';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- 0066: журнал движений защищён ДВАЖДЫ. Рубеж первый — RLS'
--
-- У обычного пользователя политик UPDATE и DELETE нет вовсе, поэтому
-- Postgres не роняет запрос, а молча не находит ни одной строки.
-- Проверяем именно это: данные не изменились и не исчезли.
do $$
declare v_id uuid; v_qty numeric; v_after numeric; v_cnt bigint;
begin
  select id, quantity into v_id, v_qty
    from public.stock_movements order by created_at desc limit 1;

  update public.stock_movements set quantity = quantity + 1 where id = v_id;
  select quantity into v_after from public.stock_movements where id = v_id;
  if v_after is distinct from v_qty then
    raise exception 'ПРОВАЛ: движение переписали задним числом';
  end if;

  delete from public.stock_movements where id = v_id;
  select count(*) into v_cnt from public.stock_movements where id = v_id;
  if v_cnt <> 1 then
    raise exception 'ПРОВАЛ: движение удалили';
  end if;

  raise notice 'ok — RLS не дал ни изменить, ни удалить движение';
end $$;

reset role;

\echo '--- рубеж второй: триггер роняет попытку даже мимо RLS'
--
-- Функции SECURITY DEFINER и сам владелец базы идут мимо политик.
-- Здесь и обязан сработать триггер, добавленный в 0066: у четырёх
-- журналов соответствия защита ровно такая же.
do $$
declare v_id uuid;
begin
  select id into v_id from public.stock_movements order by created_at desc limit 1;
  update public.stock_movements set quantity = quantity + 1 where id = v_id;
  raise exception 'ПРОВАЛ: движение переписали мимо RLS';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

do $$
declare v_id uuid;
begin
  select id into v_id from public.stock_movements order by created_at desc limit 1;
  delete from public.stock_movements where id = v_id;
  raise exception 'ПРОВАЛ: движение удалили мимо RLS';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

set role authenticated;

\echo '--- 0066: стоимость склада учитывает расходники'
--
-- До 0066 представление считало только товары, и у салона без товаров
-- стоимость склада была нулём при полных полках. Цену за единицу задаём
-- здесь же: без неё считать нечего ни до, ни после правки.
update public.materials set cost_per_unit = 25
 where id = 'dddddddd-0000-0000-0000-000000000001';

select (cost_value > 0) as вартість_не_нуль_ожид_t,
       (units > 0)      as одиниці_є_ожид_t
  from public.stock_value_view
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';

reset role;

\echo '--- 0066: проведённую накладную нельзя переписать даже владельцу базы'
do $$
declare v_id uuid;
begin
  select id into v_id from public.stock_receipts where status = 'applied' limit 1;
  if v_id is null then
    raise notice 'ok — проведённых накладных в стенде нет, проверять нечего';
    return;
  end if;
  update public.stock_receipts set note = 'переписано' where id = v_id;
  raise exception 'ПРОВАЛ: проведённая накладная изменена';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- 0067: партия с истекающим сроком ставит предупреждение сама'
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;

insert into public.material_batches
  (id, tenant_id, material_id, batch_number, expiry_date, created_by)
values ('abcd0000-0000-0000-0000-0000000000ff','aaaaaaaa-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001','LOT-SOON',
        current_date + 10, '11111111-1111-1111-1111-111111111111');

reset role;

select count(*) > 0 as попередження_по_партії_ожид_t
  from public.notification_outbox
 where ref_type = 'batch'
   and ref_id = 'abcd0000-0000-0000-0000-0000000000ff';

\echo '--- 0067: пересканирование не плодит дублей'
do $$
declare v_before bigint; v_after bigint;
begin
  select count(*) into v_before from public.notification_outbox;
  perform public.rescan_expiry_warnings();
  perform public.rescan_expiry_warnings();
  select count(*) into v_after from public.notification_outbox;
  if v_after > v_before then
    raise notice 'ok — добавлено % пропущенных предупреждений', v_after - v_before;
  else
    raise notice 'ok — дублей нет, очередь не выросла';
  end if;
end $$;

do $$
declare v_a bigint; v_b bigint;
begin
  select count(*) into v_a from public.notification_outbox;
  perform public.rescan_expiry_warnings();
  select count(*) into v_b from public.notification_outbox;
  if v_b <> v_a then
    raise exception 'ПРОВАЛ: повторный проход добавил % строк', v_b - v_a;
  end if;
  raise notice 'ok — повторный проход не добавил ни одной строки';
end $$;

\echo '--- 0070: полбанки остаётся полбанкой, а не превращается в расхождение'
--
-- Главная проверка миграции 0070. До неё expected_qty и counted_qty были
-- целыми: остаток 0.5 л снимался в документ как 0, мастер вписывал 0.5,
-- и база рождала «коригування» на пустом месте — в журнале, который
-- предъявляют инспектору. Здесь весь цикл на дробном остатке: снимок,
-- факт, проведение, сходимость кэша с журналом.
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;

-- Отдельный засіб, чтобы не мешать предыдущим утверждениям этого файла.
insert into public.materials (id, tenant_id, name, unit, cost_per_unit)
values ('dddddddd-0000-0000-0000-0000000000f0',
        'aaaaaaaa-0000-0000-0000-000000000001', 'Оксид 6% (дробный)', 'л', 40);

-- Остаток движется только журналом (правило 5), и кэш пересчитывает сама
-- record_stock_movement — триггера на вставке в журнал нет намеренно.
-- Прямая вставка в stock_movements оставила бы кэш нулевым: это не обход,
-- это отсутствие второго пути.
select (public.record_stock_movement(
  p_tenant_id     => 'aaaaaaaa-0000-0000-0000-000000000001',
  p_movement_type => 'receipt',
  p_quantity      => 2.5,
  p_material_id   => 'dddddddd-0000-0000-0000-0000000000f0'
)).id is not null as прихід_пройшов_ожид_t;

select current_stock as залишок_ожид_2_5
  from public.materials where id = 'dddddddd-0000-0000-0000-0000000000f0';

do $$
declare v_count uuid; v_expected numeric; v_line uuid;
begin
  v_count := (public.start_stock_count(
    'aaaaaaaa-0000-0000-0000-000000000001', null,
    array['dddddddd-0000-0000-0000-0000000000f0'::uuid]
  )).id;

  select id, expected_qty into v_line, v_expected
    from public.stock_count_lines
   where count_id = v_count
     and material_id = 'dddddddd-0000-0000-0000-0000000000f0';

  if v_expected <> 2.5 then
    raise exception 'ПРОВАЛ: снимок остатка округлился — в документе % замість 2.5', v_expected;
  end if;

  -- На полке нашлось меньше: 2.25 л. Разница ровно четверть литра.
  update public.stock_count_lines set counted_qty = 2.25 where id = v_line;
  perform public.apply_stock_count(v_count);

  raise notice 'ok — дробный пересчёт прошёл без округления';
end $$;

\echo '--- дробное расхождение разнесено движением ровно на 0.25'
select quantity as кількість_ожид_мінус_0_25
  from public.stock_movements
 where material_id = 'dddddddd-0000-0000-0000-0000000000f0'
   and reference_type = 'stock_count'
 order by created_at desc limit 1;

\echo '--- и кэш остатка сошёлся с журналом на дробях'
select (m.current_stock = 2.25) as залишок_ожид_t,
       (m.current_stock = (select coalesce(sum(quantity), 0)
                             from public.stock_movements sm
                            where sm.material_id = m.id)) as кеш_дорівнює_журналу_ожид_t
  from public.materials m where m.id = 'dddddddd-0000-0000-0000-0000000000f0';

\echo '--- 0070: отрицательный факт не заводится'
do $$
declare v_count uuid; v_line uuid;
begin
  v_count := (public.start_stock_count(
    'aaaaaaaa-0000-0000-0000-000000000001', null,
    array['dddddddd-0000-0000-0000-0000000000f0'::uuid]
  )).id;
  select id into v_line from public.stock_count_lines where count_id = v_count;
  update public.stock_count_lines set counted_qty = -1 where id = v_line;
  raise exception 'ПРОВАЛ: минус на полке приняли за факт';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- 0071: сканер наліпки отдаёт material_id для сопоставления'
--
-- Экран инвентаризации сопоставляет отсканированную наклейку со строкой
-- документа по идентификатору. Пока функция отдавала одно название,
-- сопоставление было бы по строке — а имена засобів различаются одним словом.
do $$
declare v_has boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'scan_container'
  ) into v_has;
  -- Функция, а не таблица: спрашиваем у самой сигнатуры.
  select exists (
    select 1
      from pg_proc p
      join unnest(p.proargnames, p.proargmodes) as a(nm, md) on true
     where p.proname = 'scan_container'
       and a.nm = 'material_id' and a.md = 't'
  ) into v_has;
  if not v_has then
    raise exception 'ПРОВАЛ: scan_container не повертає material_id';
  end if;
  raise notice 'ok — scan_container отдаёт material_id';
end $$;

reset role;

\echo '--- 0075: tenant_id дочерних строк ВЫВОДИТСЯ, подделать его нельзя'
--
-- Решение шага 3 плана: четыре таблицы получили собственный tenant_id,
-- и политики перестали ходить подзапросом к родителю. Опасность такого
-- переноса в том, что колонка, ПРИНЯТАЯ снаружи, открыла бы новую дыру:
-- строка со своим tenant_id и ЧУЖИМ receipt_id прошла бы политику
-- и легла в чужой документ. Поэтому значение не принимается, а выводится
-- триггером из родителя. Здесь это и проверяется — попыткой подделать.
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;

do $$
declare
  v_receipt uuid;
  v_line    uuid;
  v_tenant  uuid;
begin
  insert into public.stock_receipts (tenant_id, created_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111')
  returning id into v_receipt;

  -- Подсовываем ЗАВЕДОМО ЧУЖОЙ арендатор. Триггер обязан его перезаписать.
  insert into public.stock_receipt_lines
    (receipt_id, material_id, quantity, tenant_id)
  values (v_receipt, 'dddddddd-0000-0000-0000-000000000001', 1,
          '00000000-0000-0000-0000-0000000000ff')
  returning id, tenant_id into v_line, v_tenant;

  if v_tenant <> 'aaaaaaaa-0000-0000-0000-000000000001' then
    raise exception 'ПРОВАЛ: підроблений tenant_id прийнято — %', v_tenant;
  end if;
  raise notice 'ok — tenant_id виведено з документа, підробку перезаписано';

  -- И при изменении строки тоже: иначе подделку внесли бы вторым шагом.
  update public.stock_receipt_lines
     set tenant_id = '00000000-0000-0000-0000-0000000000ff'
   where id = v_line;

  select tenant_id into v_tenant from public.stock_receipt_lines where id = v_line;
  if v_tenant <> 'aaaaaaaa-0000-0000-0000-000000000001' then
    raise exception 'ПРОВАЛ: підробку внесли зміною рядка — %', v_tenant;
  end if;
  raise notice 'ok — зміна рядка теж не дає підробити орендаря';
end $$;

reset role;
