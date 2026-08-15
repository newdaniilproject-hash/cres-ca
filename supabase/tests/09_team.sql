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
          '99999999-9999-9999-9999-999999999999', 'operator', '["stock.read"]'::jsonb)
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
