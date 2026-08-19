-- 33. Фото, заметка и произвольные поля расходника (0111).

begin;

\echo '=== 33. Фото, нотатка і власні поля засобу ==='

insert into public.tenants (id, slug, name)
values ('33000000-0000-0000-0000-000000000001', 'test-photo', 'Тест фото');

insert into public.materials (id, tenant_id, name, unit)
values ('33000000-0000-0000-0000-0000000000aa',
        '33000000-0000-0000-0000-000000000001', 'Рукавички', 'пара');

\echo '--- умолчание: произвольных полей нет, но колонка объект'
select case when attributes = '{}'::jsonb then 'ок'
            else 'ПРОВАЛ: ' || attributes::text end as проверка
  from public.materials where id = '33000000-0000-0000-0000-0000000000aa';

\echo '--- заметка и свои поля пишутся'
update public.materials
   set note = 'Брати у другого постачальника, перші тонші',
       attributes = '{"полиця": "B3", "запасний постачальник": "Хімпром"}'::jsonb
 where id = '33000000-0000-0000-0000-0000000000aa';
select case when note is not null and attributes ->> 'полиця' = 'B3' then 'ок'
            else 'ПРОВАЛ: не збереглося' end as проверка
  from public.materials where id = '33000000-0000-0000-0000-0000000000aa';

\echo '--- ГЛАВНОЕ: произвольные поля обязаны быть ОБЪЕКТОМ'
do $$
begin
  update public.materials set attributes = '["полиця"]'::jsonb
   where id = '33000000-0000-0000-0000-0000000000aa';
  raise warning 'ПРОВАЛ: масив прийнято як власні поля';
exception when check_violation then
  raise notice 'ок: масив відбито';
end $$;

\echo '--- ГЛАВНОЕ: чужой путь к фото не записать'
do $$
begin
  update public.materials
     set image_path = '99999999-9999-9999-9999-999999999999/gloves.jpg'
   where id = '33000000-0000-0000-0000-0000000000aa';
  raise warning 'ПРОВАЛ: шлях чужого закладу прийнято';
exception when others then
  raise notice 'ок: чужий шлях відбито (%)', sqlerrm;
end $$;

\echo '--- свой путь записывается'
update public.materials
   set image_path = '33000000-0000-0000-0000-000000000001/gloves.jpg'
 where id = '33000000-0000-0000-0000-0000000000aa';
select case when image_path is not null then 'ок' else 'ПРОВАЛ: свій шлях не прийнято' end as проверка
  from public.materials where id = '33000000-0000-0000-0000-0000000000aa';

\echo '--- инспектор видит фото, но НЕ видит заметок и своих полей'
select case
         when count(*) filter (where column_name = 'image_path') = 1
          and count(*) filter (where column_name in ('note', 'attributes')) = 0
         then 'ок'
         else 'ПРОВАЛ: склад представлення не той' end as проверка
  from information_schema.columns
 where table_schema = 'public' and table_name = 'compliance_materials';

rollback;
