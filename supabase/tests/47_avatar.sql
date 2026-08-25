-- 47. Своё фото (0130).
--
-- Граница здесь проведена не по праву, а по ПУТИ, и такую границу легко
-- написать так, что она выглядит рабочей и не работает. Поэтому каждый
-- сценарий — это ПОПЫТКА её нарушить, а не проверка наличия политики.
--
-- Главное, ради чего этот набор существует: инспектор (у него НЕТ
-- `catalog.write`) обязан суметь поставить СЕБЕ фото и обязан не суметь
-- поставить фото ЗА ДРУГОГО. Первое — смысл 0130, второе — её граница.

\set ON_ERROR_STOP on

-- Инспектор заклада 1 (0015): в закладе есть, `catalog.write` не имеет.
\set QUIET on
select test.login('44444444-4444-4444-4444-444444444444');
\set QUIET off
set role authenticated;

\echo '--- 0130: своє фото кладе навіть той, у кого немає catalog.write'
insert into storage.objects (bucket_id, name, owner)
values ('media','aaaaaaaa-0000-0000-0000-000000000001/avatars/44444444-4444-4444-4444-444444444444.jpg',
        '44444444-4444-4444-4444-444444444444');
select count(*) as своє_фото_ожид_1 from storage.objects
 where name = 'aaaaaaaa-0000-0000-0000-000000000001/avatars/44444444-4444-4444-4444-444444444444.jpg';

\echo '--- 0130: чуже фото підмінити не можна'
-- Той самий заклад, той самий каталог `avatars`, інший user_id у імені.
do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('media','aaaaaaaa-0000-0000-0000-000000000001/avatars/11111111-1111-1111-1111-111111111111.jpg');
  raise exception 'ПРОВАЛ: підмінено фото іншої людини';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0130: своє фото в ЧУЖИЙ заклад не кладеться'
do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('media','aaaaaaaa-0000-0000-0000-000000000091/avatars/44444444-4444-4444-4444-444444444444.jpg');
  raise exception 'ПРОВАЛ: фото покладено в чужий заклад';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0130: каталог `avatars` не відкриває решту бакета'
-- Тут ловиться найімовірніша помилка написання: перевірити тільки імʼя
-- файлу і забути про другий сегмент. Тоді дозвіл на своє фото став би
-- дозволом класти будь-що будь-куди, аби файл звався своїм id.
do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('media','aaaaaaaa-0000-0000-0000-000000000001/offerings/44444444-4444-4444-4444-444444444444.jpg');
  raise exception 'ПРОВАЛ: дозвіл на аватар відкрив каталог товарів';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0130: своє фото переносити в чужий шлях не можна (with check у UPDATE)'
-- У UPDATE дві половини. Забутий `with check` виглядає як робоча
-- політика рівно до цього рядка.
do $$
begin
  update storage.objects
     set name = 'aaaaaaaa-0000-0000-0000-000000000001/avatars/11111111-1111-1111-1111-111111111111.jpg'
   where name = 'aaaaaaaa-0000-0000-0000-000000000001/avatars/44444444-4444-4444-4444-444444444444.jpg';
  raise exception 'ПРОВАЛ: своє фото перенесено на чуже імʼя';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0130: своє фото видаляється'
delete from storage.objects
 where name = 'aaaaaaaa-0000-0000-0000-000000000001/avatars/44444444-4444-4444-4444-444444444444.jpg';
select count(*) as після_видалення_ожид_0 from storage.objects
 where name = 'aaaaaaaa-0000-0000-0000-000000000001/avatars/44444444-4444-4444-4444-444444444444.jpg';

reset role;

\echo '--- 0130: анонім фото НЕ кладе'
set role anon;
do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('media','aaaaaaaa-0000-0000-0000-000000000001/avatars/44444444-4444-4444-4444-444444444444.jpg');
  raise exception 'ПРОВАЛ: анонім поклав фото';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;
