-- 32. Реестр модулей (0110).
--
-- Проверяем ПОПЫТКАМИ, а не наличием таблицы: «объект существует»
-- показывало бы зелёное и на пустом сторожe.

begin;

\echo '=== 32. Реєстр модулів ==='

\echo '--- реестр заполнен и в нём есть набор по умолчанию'
select case when count(*) >= 9 then 'ок' else 'ПРОВАЛ: модулів ' || count(*) end as проверка
  from public.modules;
select case when count(*) = 7 then 'ок'
            else 'ПРОВАЛ: у наборі за замовчуванням ' || count(*) end as проверка
  from public.modules where is_default and is_active;

\echo '--- новый заклад получает набор ИЗ РЕЕСТРА, а не из копии списка'
insert into public.tenants (id, slug, name)
values ('32000000-0000-0000-0000-000000000001', 'test-registry', 'Тест реєстру');

select case
         when modules @> array['inventory','compliance','bookings','catalog',
                               'orders','customers','storefront']
           and not (modules @> array['finance'])
         then 'ок'
         else 'ПРОВАЛ: набір ' || array_to_string(modules, ',')
       end as проверка
  from public.tenants where id = '32000000-0000-0000-0000-000000000001';

\echo '--- ГЛАВНОЕ: несуществующий модуль не вставляется'
do $$
begin
  update public.tenants set modules = array['inventory','invetory']
   where id = '32000000-0000-0000-0000-000000000001';
  raise warning 'ПРОВАЛ: опечатка в модулі пройшла';
exception when others then
  raise notice 'ок: невідомий модуль відбито (%)', sqlerrm;
end $$;

\echo '--- выключенный модуль тоже не выдаётся'
insert into public.modules (code, title, is_active) values ('legacy_thing', 'Знято з продукту', false);
do $$
begin
  update public.tenants set modules = array['inventory','legacy_thing']
   where id = '32000000-0000-0000-0000-000000000001';
  raise warning 'ПРОВАЛ: вимкнений модуль видано';
exception when others then
  raise notice 'ок: вимкнений модуль відбито';
end $$;

\echo '--- существующий модуль ставится'
update public.tenants set modules = array['inventory','finance']
 where id = '32000000-0000-0000-0000-000000000001';
select case when modules @> array['finance'] then 'ок'
            else 'ПРОВАЛ: набір не оновився' end as проверка
  from public.tenants where id = '32000000-0000-0000-0000-000000000001';

\echo '--- заведение с явным набором его и получает (триггер не перетирает)'
insert into public.tenants (id, slug, name, modules)
values ('32000000-0000-0000-0000-000000000002', 'test-explicit', 'Явний набір',
        array['inventory']);
select case when modules = array['inventory'] then 'ок'
            else 'ПРОВАЛ: явний набір перетерто на ' || array_to_string(modules, ',') end as проверка
  from public.tenants where id = '32000000-0000-0000-0000-000000000002';

\echo '--- реестр не правится из кабинета'
set role authenticated;
do $$
begin
  insert into public.modules (code, title) values ('hack', 'Свій модуль');
  raise warning 'ПРОВАЛ: реєстр правиться з кабінету';
exception when others then
  raise notice 'ок: запис у реєстр відбито';
end $$;
reset role;

rollback;
