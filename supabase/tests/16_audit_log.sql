-- 16_audit_log.sql — неизменяемый журнал действий (миграция 0021).
--
-- Проверяющий спрашивает не «что стало с остатком», а «кто и когда
-- изменил запись». До 0021 правку карточки косметики, срока партии или
-- состава команды не фиксировал никто.
--
-- Журнал имеет смысл ровно при трёх условиях, и все три проверяются
-- попыткой их нарушить:
--   1) строка появляется САМА, без участия того, кого она уличает;
--   2) чужую строку не видно;
--   3) свою строку нельзя ни переписать, ни стереть — в том числе
--      сервисным ключом, иначе журнал превращается в файл, который
--      подчистили накануне проверки.

\set ON_ERROR_STOP on

\echo '--- 0021: правка карточки пишется сама, с автором и прежним значением'
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
update public.materials set name = 'Канекалон Jumbo'
 where id = 'dddddddd-0000-0000-0000-000000000001';
reset role;

select action           as дія_ожид_update,
       entity           as обєкт_ожид_materials,
       actor_email::text as автор_ожид_owner_test,
       changes -> 'name' ->> 'was' as було,
       changes -> 'name' ->> 'now' as стало_ожид_канекалон_jumbo,
       label            as підпис_ожид_канекалон_jumbo
  from public.audit_log
 where entity = 'materials' and entity_id = 'dddddddd-0000-0000-0000-000000000001'
 order by at desc, id desc limit 1;

\echo '--- 0021: холостая правка журнал НЕ засоряет'
-- Обещание из шапки: «кеши остатков и updated_at не пишутся — это шум,
-- который закрывает собой настоящие правки». Проверяем сравнением
-- количества до и после: заявленное значение равно текущему.
do $$
declare v_before bigint; v_after bigint;
begin
  select count(*) into v_before from public.audit_log where entity = 'materials';
  update public.materials set name = name
   where id = 'dddddddd-0000-0000-0000-000000000001';
  select count(*) into v_after from public.audit_log where entity = 'materials';
  if v_after <> v_before then
    raise exception 'ПРОВАЛ: холоста правка додала % рядків у журнал', v_after - v_before;
  end if;
  raise notice 'ok — журнал не виріс: % рядків', v_after;
end $$;

\echo '--- 0021: заведение новой карточки тоже попадает в журнал'
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
insert into public.materials (id, tenant_id, name, unit)
values ('aa160000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
        'Шампунь тестовий','флакон');
reset role;

select action as дія_ожид_insert,
       (changes ? 'created') as є_знімок_ожид_t,
       label as підпис_ожид_шампунь_тестовий
  from public.audit_log
 where entity = 'materials' and entity_id = 'aa160000-0000-0000-0000-000000000001'
 order by at desc, id desc limit 1;

-- Чужие строки: правим карточку «Магазин 2» от имени системы (auth.uid()
-- пуст — миграционный путь). Иначе нечего пытаться подсмотреть.
update public.materials set name = 'Чужий матеріал'
 where id = 'dddddddd-0000-0000-0000-000000000093';

\echo '--- 0021: чужой журнал не виден никому из другого заклада'
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
select count(*) as чужих_рядків_ожид_0 from public.audit_log
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000091';
select count(*) > 0 as своїх_рядків_ожид_t from public.audit_log
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;

\echo '--- 0021: владелец другого заклада не видит наш журнал вовсе'
\set QUIET on
select test.login('33333333-3333-3333-3333-333333333333');
\set QUIET off
set role authenticated;
select count(*) as чужому_власнику_ожид_0 from public.audit_log
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;

\echo '--- 0021: аноним журнала не видит'
set role anon;
select count(*) as анониму_ожид_0 from public.audit_log;
reset role;

\echo '--- 0021: строку журнала нельзя дописать руками'
-- Писать пользователь не может вообще: политики insert нет, строку
-- кладёт только триггер. Иначе в журнал можно вписать чужое действие.
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
do $$
begin
  insert into public.audit_log (tenant_id, action, entity, changes)
  values ('aaaaaaaa-0000-0000-0000-000000000001','delete','materials','{}'::jsonb);
  raise exception 'ПРОВАЛ: рядок журналу дій вписано руками';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0021: свою строку нельзя переписать'
-- RLS не бросает исключение на UPDATE без политики — она молча не находит
-- ни одной строки. Поэтому проверяется не текст ошибки, а то, что
-- НИ ОДНА строка не изменилась: «прошло 0 строк» и «прошло 5» выглядят
-- в логе одинаково, и разница между ними — это и есть журнал.
do $$
declare v_rows int;
begin
  update public.audit_log set label = 'нічого не було'
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    raise exception 'ПРОВАЛ: журнал дій переписано, рядків: %', v_rows;
  end if;
  raise notice 'ok — жодного рядка не змінено';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0021: свою строку нельзя стереть'
do $$
declare v_rows int;
begin
  delete from public.audit_log where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    raise exception 'ПРОВАЛ: рядків журналу дій видалено: %', v_rows;
  end if;
  raise notice 'ok — жодного рядка не видалено';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

\echo '--- 0021: и сервисным ключом тоже нельзя'
-- Второй замок — триггер, а не только отсутствие политик. Ниже правка
-- идёт от роли, которой RLS не писан; остановить её обязан триггер.
do $$
begin
  delete from public.audit_log where entity = 'materials';
  raise exception 'ПРОВАЛ: журнал дій стерли в обхід політик';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

do $$
begin
  update public.audit_log set changes = '{}'::jsonb where entity = 'materials';
  raise exception 'ПРОВАЛ: журнал дій переписали в обхід політик';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0021: журнал держит имя объекта на момент действия'
-- Карточку могли переименовать; журнал должен читаться и через год.
-- Ниже — та самая первая правка: имя «Нитки» больше не существует
-- ни в одной таблице, а в журнале оно есть.
select count(*) > 0 as старе_імя_збережено_ожид_t
  from public.audit_log
 where entity = 'materials'
   and entity_id = 'dddddddd-0000-0000-0000-000000000001'
   and changes -> 'name' ->> 'was' is not null;
