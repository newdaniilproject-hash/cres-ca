-- 07_register_card.sql — карточка реестра и розлив: то, что добавили
-- миграции 0059–0063 под экраны ТЗ 3.1 и 3.2.
--
-- Проверяем не «колонка появилась», а поведение: что запрещено, что
-- разрешено и кому. Продолжает данные 01–05.

\set ON_ERROR_STOP on
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;

\echo '--- 0059: ссылка на реестр МОЗ обязана быть ссылкой'
do $$ begin
  update public.materials
     set notification_url = 'дивись у папці'
   where id = 'dddddddd-0000-0000-0000-000000000001';
  raise exception 'ПРОВАЛ: в поле ссылки записали свободный текст';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- 0059: нормальная ссылка и дата внесения сохраняются'
update public.materials
   set notification_url  = 'https://cosmetics.moz.gov.ua/notification/UA.TR.116.003-25',
       notification_date = current_date - 30
 where id = 'dddddddd-0000-0000-0000-000000000001';

select notification_code is not null as код_есть_ожид_t,
       notification_url like 'https://%' as ссылка_есть_ожид_t,
       notification_date = current_date - 30 as дата_верна_ожид_t
  from public.materials where id = 'dddddddd-0000-0000-0000-000000000001';

\echo '--- 0059: партия, выпущенная позже своего срока годности, — не опечатка, а брак данных'
do $$ begin
  update public.material_batches
     set manufactured_date = expiry_date + 1
   where id = 'abcd0000-0000-0000-0000-000000000001';
  raise exception 'ПРОВАЛ: дата изготовления позже срока годности прошла';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

update public.material_batches
   set manufactured_date = current_date - 60
 where id = 'abcd0000-0000-0000-0000-000000000001';

\echo '--- 0059: размер файла не может быть нулевым или отрицательным'
do $$ begin
  insert into public.material_documents
    (tenant_id, material_id, kind, title, path, uploaded_by, size_bytes, mime)
  values ('aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001',
          'msds','Пустой файл',
          'aaaaaaaa-0000-0000-0000-000000000001/materials/d/zero.pdf',
          '11111111-1111-1111-1111-111111111111', 0, 'application/pdf');
  raise exception 'ПРОВАЛ: документ нулевого размера прошёл';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

insert into public.material_documents
  (tenant_id, material_id, kind, title, path, uploaded_by, size_bytes, mime)
values ('aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001',
        'msds','Паспорт безпеки',
        'aaaaaaaa-0000-0000-0000-000000000001/materials/d/msds.pdf',
        '11111111-1111-1111-1111-111111111111', 1258291, 'application/pdf');

\echo '--- 3.2: розлив функцией — код от счётчика, партия наследуется, срок не «омолаживается»'
update public.material_containers set volume = 500, unit = 'мл'
 where code = 'CNT-001';

select (public.decant_container('abcd0000-0000-0000-0000-000000000002', 120,
                                'робоча ємність №1')).code as код_дозатора;

select c.code,
       c.volume = 120                       as объём_ожид_t,
       c.parent_id is not null              as есть_родитель_ожид_t,
       c.batch_id  is not null              as партия_унаследована_ожид_t,
       c.decanted_at is not null            as дата_розлива_есть_ожид_t,
       c.use_by <= p.use_by                 as не_позже_родителя_ожид_t,
       p.volume = 380                       as остаток_родителя_ожид_t
  from public.material_containers c
  join public.material_containers p on p.id = c.parent_id
 where c.code like 'C-%';

\echo '--- 3.2: наклейка отдаёт ровно пять реквизитов ТЗ'
select public.container_label(id) like 'Засіб: %Партія: %Розлив: %Майстер: %Придатне до: %'
         as пять_реквизитов_ожид_t
  from public.material_containers where code like 'C-%';

\echo '--- 3.2: перелить больше, чем есть в банке, нельзя'
do $$ begin
  perform public.decant_container('abcd0000-0000-0000-0000-000000000002', 100000, null);
  raise exception 'ПРОВАЛ: разлили больше, чем было в банке';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

reset role;

\echo '--- 0060–0063: ИНСПЕКТОР видит нотификацию целиком и не может ничего править'
\set QUIET on
select test.login('44444444-4444-4444-4444-444444444444');
\set QUIET off
set role authenticated;

select count(*) filter (where notification_url is not null) as ссылок_видно_ожид_1,
       count(*) filter (where notification_date is not null) as дат_видно_ожид_1
  from public.compliance_materials;

select count(*) filter (where manufactured_date is not null) as дат_выпуска_видно_ожид_1
  from public.compliance_batches;

reset role;

-- ГРАБЛИ 0060, ради которых написан этот кусок.
--
-- Supabase держит на схеме public «alter default privileges», отдающий ВСЕ
-- права ролям anon и authenticated на каждый ВНОВЬ созданный объект. Значит
-- любое пересоздание представления молча делает его записываемым. А
-- compliance_materials — представление простое (одна таблица плюс where),
-- то есть автообновляемое, и выполняется правами ВЛАДЕЛЬЦА, мимо RLS.
-- Инспектор, у которого по ТЗ только чтение, переписал бы реестр.
--
-- Стенд повторяет ровно эту раздачу (01_permissions выдаёт all on all tables),
-- поэтому здесь мы её воспроизводим намеренно, а затем прогоняем лечение
-- из 0061 и проверяем, что оно действительно отбирает лишнее.
\echo '--- воспроизводим раздачу прав Supabase на представлении'
grant all on public.compliance_materials to authenticated;

\echo '--- лечение из 0061'
revoke all on public.compliance_materials from anon, authenticated, public;
grant select on public.compliance_materials to authenticated;

select has_table_privilege('authenticated','public.compliance_materials','SELECT') as чтение_ожид_t,
       has_table_privilege('authenticated','public.compliance_materials','UPDATE') as правка_ожид_f,
       has_table_privilege('authenticated','public.compliance_materials','DELETE') as удаление_ожид_f;

set role authenticated;

\echo '--- инспектор не может править реестр через представление'
do $$ begin
  update public.compliance_materials set name = 'переписано інспектором';
  raise exception 'ПРОВАЛ: инспектор переписал реестр через представление';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- и не может удалить строку реестра через представление'
do $$ begin
  delete from public.compliance_materials;
  raise exception 'ПРОВАЛ: инспектор удалил реестр через представление';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- чтение при этом работает: отбирали лишнее, а не всё'
select count(*) > 0 as реестр_читается_ожид_t from public.compliance_materials;

\echo '--- инспектору по-прежнему нельзя в исходные таблицы напрямую'
select (select count(*) from public.materials) as материалов_напрямую_ожид_0;

reset role;
