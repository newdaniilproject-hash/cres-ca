-- 09_team.sql — права, журнал прав и сеансы (миграция 0076).
--
-- Проверяется ПОВЕДЕНИЕ: что теперь нельзя сделать даже владельцу,
-- что записывается само и чего нельзя стереть. Продолжает данные 01–08.
--
-- Каждый запрет проверяется ПОПЫТКОЙ его нарушить. Проверка «колонка
-- существует» не доказывает ничего: колонка может быть, а триггер
-- отключён, и узнаётся это в день, когда сотрудник выдал себе владение.

\set ON_ERROR_STOP on
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;

\echo '--- 0076: владелец НЕ понижает сам себя'
do $$
begin
  update public.tenant_members
     set role = 'viewer'
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and user_id = '11111111-1111-1111-1111-111111111111';
  raise exception 'ПРОВАЛ: власник понизив сам себе';
exception when others then
  if position('понизити себе' in sqlerrm) > 0 then
    raise notice 'ok — %', sqlerrm;
  elsif sqlerrm like 'ПРОВАЛ%' then raise;
  else raise notice 'ok (інша заборона) — %', sqlerrm;
  end if;
end $$;

\echo '--- 0076: свои собственные права изменить нельзя'
do $$
begin
  update public.tenant_members
     set permissions = '["*"]'::jsonb
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and user_id = '11111111-1111-1111-1111-111111111111';
  raise exception 'ПРОВАЛ: собі розширили права';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0076: журнал прав пишется САМ при изменении участника'
reset role;
-- Заводим второго участника от имени системы (auth.uid() пуст — это
-- миграционный путь, запреты триггера к нему не относятся).
insert into auth.users (id, email)
  values ('99999999-9999-9999-9999-999999999999', 'worker@test')
  on conflict (id) do nothing;
insert into public.tenant_members (tenant_id, user_id, role, permissions)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          -- Форма ОБЪЕКТ, а не массив. Здесь стоял `["stock.read"]`, и тест
          -- был зелёным: хук выдачи токена в нём не звался, а без хука
          -- массив ничем не мешает. Ограничение из 0079 теперь его не пустит.
          '99999999-9999-9999-9999-999999999999', 'operator', '{"stock.read": true}'::jsonb)
  on conflict (tenant_id, user_id) do nothing;

select count(*) > 0 as запис_про_додавання_ожид_t
  from public.permission_audit
 where target = '99999999-9999-9999-9999-999999999999' and action = 'added';

\echo '--- 0076: смена роли пишется в журнал И рвёт сеансы'
insert into auth.sessions (user_id) values ('99999999-9999-9999-9999-999999999999');
select count(*) as сеансів_до_ожид_1
  from auth.sessions where user_id = '99999999-9999-9999-9999-999999999999';

update public.tenant_members set role = 'viewer'
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and user_id = '99999999-9999-9999-9999-999999999999';

select count(*) as сеансів_після_ожид_0
  from auth.sessions where user_id = '99999999-9999-9999-9999-999999999999';

select role_before::text || '->' || role_after::text as зміна_ожид_operator_viewer
  from public.permission_audit
 where target = '99999999-9999-9999-9999-999999999999' and action = 'changed'
 order by at desc limit 1;

\echo '--- 0076: журнал прав НЕИЗМЕНЯЕМ'
do $$
begin
  update public.permission_audit set action = 'added'
   where target = '99999999-9999-9999-9999-999999999999';
  raise exception 'ПРОВАЛ: журнал прав переписали';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

do $$
begin
  delete from public.permission_audit
   where target = '99999999-9999-9999-9999-999999999999';
  raise exception 'ПРОВАЛ: запис журналу прав видалили';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0076: чужой не читает журнал прав соседнего заведения'
select test.login('22222222-2222-2222-2222-222222222222');
set role authenticated;
select count(*) as чужих_записів_ожид_0
  from public.permission_audit
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;

\echo '--- 0076: список сеансов отдаёт только своих'
-- Сеанс заводим ДО перехода в роль пользователя: писать в схему `auth`
-- вошедшему нельзя, и это правильно — сеансы создаёт платформа, а не
-- приложение. На стенде их создаём мы, но тоже от служебной роли.
insert into auth.sessions (user_id, user_agent) values
  ('11111111-1111-1111-1111-111111111111', 'test-agent');
select test.login('11111111-1111-1111-1111-111111111111');
set role authenticated;
select count(*) > 0 as свої_сеанси_видно_ожид_t
  from public.team_sessions('aaaaaaaa-0000-0000-0000-000000000001');
reset role;

\echo '--- 0076: последний владелец остаётся владельцем'
reset role;
do $$
begin
  delete from public.tenant_members
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and role = 'owner';
  raise exception 'ПРОВАЛ: останнього власника прибрали';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

-- ===========================================================================
-- 0079. Блокировка участника, форма прав, состав команды
-- ===========================================================================

\echo '--- 0079: форма прав — только объект, массив не проходит'
reset role;
do $$
begin
  update public.tenant_members set permissions = '["stock.read"]'::jsonb
   where user_id = '99999999-9999-9999-9999-999999999999';
  raise exception 'ПРОВАЛ: у права учасника поклали масив — вхід зламався б';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0079: хук выдачи токена работает для участника'
-- Прямая проверка того, ради чего стоит ограничение: если в правах лежит
-- не объект, эта строка падает с «cannot deconstruct an array as an object»
-- и человек не входит вовсе.
select (public.custom_access_token_hook(
          jsonb_build_object('user_id', '99999999-9999-9999-9999-999999999999',
                             'claims', '{}'::jsonb))
        -> 'claims' -> 'app_metadata' -> 'memberships') is not null
       as токен_видається_ожид_t;

\echo '--- 0079: блокировка участника без карточки мастера'
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;

select public.block_member('aaaaaaaa-0000-0000-0000-000000000001',
                           '99999999-9999-9999-9999-999999999999', 'звільнений');
reset role;

select public.member_access_ok('aaaaaaaa-0000-0000-0000-000000000001',
                               '99999999-9999-9999-9999-999999999999')
       as доступ_після_блокування_ожид_f;

select (public.custom_access_token_hook(
          jsonb_build_object('user_id', '99999999-9999-9999-9999-999999999999',
                             'claims', '{}'::jsonb))
        -> 'claims' -> 'app_metadata' -> 'memberships') = '{}'::jsonb
       as заклад_зник_із_токена_ожид_t;

\echo '--- 0079: разблокировка возвращает доступ'
set role authenticated;
select public.unblock_member('aaaaaaaa-0000-0000-0000-000000000001',
                             '99999999-9999-9999-9999-999999999999');
reset role;
select public.member_access_ok('aaaaaaaa-0000-0000-0000-000000000001',
                               '99999999-9999-9999-9999-999999999999')
       as доступ_після_розблокування_ожид_t;

\echo '--- 0079: себя заблокировать нельзя'
set role authenticated;
do $$
begin
  perform public.block_member('aaaaaaaa-0000-0000-0000-000000000001',
                              '11111111-1111-1111-1111-111111111111');
  raise exception 'ПРОВАЛ: власник заблокував сам себе і втратив заклад';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0079: чужой заклад заблокировать нельзя'
do $$
begin
  perform public.block_member('aaaaaaaa-0000-0000-0000-000000000002',
                              '22222222-2222-2222-2222-222222222222');
  raise exception 'ПРОВАЛ: заблокували учасника чужого закладу';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0079: состав команды виден своему и не виден чужому'
select count(*) > 0 as свою_команду_видно_ожид_t
  from public.team_overview('aaaaaaaa-0000-0000-0000-000000000001');
reset role;

\set QUIET on
select test.login('22222222-2222-2222-2222-222222222222');
\set QUIET off
set role authenticated;
select count(*) as чужу_команду_видно_ожид_0
  from public.team_overview('aaaaaaaa-0000-0000-0000-000000000001');
reset role;

\echo '--- 0079: шаблон с умолчанием даёт объект, а не массив'
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
insert into public.permission_templates (tenant_id, name, role)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'Майстер зміни', 'operator')
  on conflict (tenant_id, name) do nothing;

select jsonb_typeof(permissions) as форма_шаблону_ожид_object
  from public.permission_templates
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and name = 'Майстер зміни';

select public.apply_permission_template(
         'aaaaaaaa-0000-0000-0000-000000000001',
         '99999999-9999-9999-9999-999999999999',
         (select id from public.permission_templates
           where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
             and name = 'Майстер зміни'));
reset role;

select (public.custom_access_token_hook(
          jsonb_build_object('user_id', '99999999-9999-9999-9999-999999999999',
                             'claims', '{}'::jsonb))
        -> 'claims' -> 'app_metadata' -> 'memberships') <> '{}'::jsonb
       as вхід_після_шаблону_ожид_t;
