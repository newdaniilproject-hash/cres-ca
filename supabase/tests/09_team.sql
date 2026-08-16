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

-- ===========================================================================
-- 0080. Журнал покрывает ВСЕ признаки доступа, а блокировка рвёт сеансы
-- ===========================================================================
--
-- Каждая проверка ниже ловит то, что 0079 сломала молча: изменение
-- проходило, журнал молчал, сеанс жил.

\echo '--- 0080: блокировка попадает в журнал с причиной'
reset role;
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
select public.block_member('aaaaaaaa-0000-0000-0000-000000000001',
                           '99999999-9999-9999-9999-999999999999', 'звільнення за прогул');
reset role;

select action as дія_ожид_blocked, note as причина_ожид_прогул
  from public.permission_audit
 where target = '99999999-9999-9999-9999-999999999999'
 order by at desc limit 1;

\echo '--- 0080: блокировка ОБРЫВАЕТ сеанс немедленно'
-- Заводим сеанс до блокировки, снимаем блокировку, ставим снова и смотрим.
select public.unblock_member('aaaaaaaa-0000-0000-0000-000000000001',
                             '99999999-9999-9999-9999-999999999999');
insert into auth.sessions (user_id) values ('99999999-9999-9999-9999-999999999999');
select count(*) as сеансів_до_ожид_1
  from auth.sessions where user_id = '99999999-9999-9999-9999-999999999999';

\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
select public.block_member('aaaaaaaa-0000-0000-0000-000000000001',
                           '99999999-9999-9999-9999-999999999999', 'повторно');
reset role;

select count(*) as сеансів_після_ожид_0
  from auth.sessions where user_id = '99999999-9999-9999-9999-999999999999';

\echo '--- 0080: разблокировка тоже событие журнала'
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
select public.unblock_member('aaaaaaaa-0000-0000-0000-000000000001',
                             '99999999-9999-9999-9999-999999999999');
reset role;
select action as дія_ожид_unblocked
  from public.permission_audit
 where target = '99999999-9999-9999-9999-999999999999'
 order by at desc limit 1;

\echo '--- 0080: срок доступа — в журнал И с разрывом сеансов'
insert into auth.sessions (user_id) values ('99999999-9999-9999-9999-999999999999');
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
update public.tenant_members set access_expires_at = now() + interval '3 days'
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and user_id = '99999999-9999-9999-9999-999999999999';
reset role;

select count(*) as сеансів_після_строку_ожид_0
  from auth.sessions where user_id = '99999999-9999-9999-9999-999999999999';
select action as дія_ожид_changed, note is not null as є_пояснення_ожид_t
  from public.permission_audit
 where target = '99999999-9999-9999-9999-999999999999'
 order by at desc limit 1;

\echo '--- 0080: стеля знижки — в журнал, но БЕЗ разрыва сеансов'
insert into auth.sessions (user_id) values ('99999999-9999-9999-9999-999999999999');
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
update public.tenant_members set discount_cap_pct = 15
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and user_id = '99999999-9999-9999-9999-999999999999';
reset role;

select count(*) as сеанс_вцілів_ожид_1
  from auth.sessions where user_id = '99999999-9999-9999-9999-999999999999';
select note like '%стеля%' as стеля_в_журналі_ожид_t
  from public.permission_audit
 where target = '99999999-9999-9999-9999-999999999999'
 order by at desc limit 1;

\echo '--- 0080: правка без изменений журнал НЕ засоряет'
select count(*) as записів_до from public.permission_audit
 where target = '99999999-9999-9999-9999-999999999999';
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
update public.tenant_members set discount_cap_pct = 15
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and user_id = '99999999-9999-9999-9999-999999999999';
reset role;
select count(*) as записів_після_має_збігтися from public.permission_audit
 where target = '99999999-9999-9999-9999-999999999999';

\echo '--- 0080: журнал с именами виден своему и не виден чужому'
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
select count(*) > 0 as свій_журнал_ожид_t
  from public.permission_audit_log('aaaaaaaa-0000-0000-0000-000000000001', 50);
reset role;

\set QUIET on
select test.login('22222222-2222-2222-2222-222222222222');
\set QUIET off
set role authenticated;
select count(*) as чужий_журнал_ожид_0
  from public.permission_audit_log('aaaaaaaa-0000-0000-0000-000000000001', 50);
reset role;

\echo '--- 0080: разница точечных дозволов считается базой'
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
update public.tenant_members set permissions = '{"finances.read": true}'::jsonb
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and user_id = '99999999-9999-9999-9999-999999999999';

select 'finances.read' = any(perms_added) as додане_видно_ожид_t
  from public.permission_audit_log('aaaaaaaa-0000-0000-0000-000000000001', 5)
 order by at desc limit 1;

update public.tenant_members set permissions = '{}'::jsonb
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and user_id = '99999999-9999-9999-9999-999999999999';

select 'finances.read' = any(perms_removed) as знятe_видно_ожид_t
  from public.permission_audit_log('aaaaaaaa-0000-0000-0000-000000000001', 5)
 order by at desc limit 1;
reset role;

\echo '--- 0080: журнал остаётся неизменяемым и после расширения'
do $$
begin
  update public.permission_audit set note = 'підчистили'
   where target = '99999999-9999-9999-9999-999999999999';
  raise exception 'ПРОВАЛ: причину в журналі переписали';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

-- ===========================================================================
-- 0081. Эскалация ОТ ИМЕНИ АДМИНА, а не владельца
-- ===========================================================================
--
-- Всё выше проверяется от имени ВЛАДЕЛЬЦА, у которого максимальный ранг
-- и «*» в правах. Такой актор проходит любую проверку ранга, поэтому
-- снятая проверка ранга в этих сценариях принципиально не видна: они
-- зелены и на дырявой базе. Ниже заводится отдельный участник — роль
-- `admin`, точечный `team.write` — и вся эскалация проверяется ЕГО руками.
--
-- `finances.write` снято у него точечно намеренно: по роли `admin` имеет
-- всё, и проверить запрет «нельзя выдать то, чего нет у тебя самого»
-- было бы нечем.

\echo '--- 0081: заводим админа с точечным team.write, жертву и запасного'
reset role;
insert into auth.users (id, email) values
  ('a0a0a0a0-0000-0000-0000-0000000000aa','admin@test'),
  ('b0b0b0b0-0000-0000-0000-0000000000bb','victim@test'),
  ('c0c0c0c0-0000-0000-0000-0000000000cc','spare@test'),
  ('e0e0e0e0-0000-0000-0000-0000000000ee','newbie@test.ua'),
  ('f0f0f0f0-0000-0000-0000-0000000000ff','manager@test')
on conflict (id) do nothing;

insert into public.tenant_members (tenant_id, user_id, role, permissions) values
  ('aaaaaaaa-0000-0000-0000-000000000001','a0a0a0a0-0000-0000-0000-0000000000aa','admin',
   '{"team.write": true, "finances.write": false}'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000000001','b0b0b0b0-0000-0000-0000-0000000000bb','viewer',
   '{}'::jsonb),
  -- Ранг администратора проверить им самим нельзя: выше него только
  -- владелец, а второго владельца не пускает уникальный индекс из 0001 —
  -- и проверка ранга оказалась бы «зелёной» по чужой причине. Поэтому
  -- ранг проверяется руками управляющего: ему точечно выдан team.write,
  -- по роли его нет.
  ('aaaaaaaa-0000-0000-0000-000000000001','f0f0f0f0-0000-0000-0000-0000000000ff','manager',
   '{"team.write": true}'::jsonb)
on conflict (tenant_id, user_id) do nothing;

-- Срок доступа админу ставит владелец — чтобы было что «отодвигать себе».
update public.tenant_members set access_expires_at = now() + interval '1 day'
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and user_id = 'a0a0a0a0-0000-0000-0000-0000000000aa';

-- Карточки мастера: владельцу — чтобы проверить отъём доступа через staff,
-- жертве — чтобы проверить рассинхрон блокировок.
insert into public.staff (tenant_id, user_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Власник'),
  ('aaaaaaaa-0000-0000-0000-000000000001','b0b0b0b0-0000-0000-0000-0000000000bb','Жертва')
on conflict (tenant_id, user_id) do nothing;

\set QUIET on
select test.login('a0a0a0a0-0000-0000-0000-0000000000aa');
\set QUIET off
set role authenticated;

select public.tenant_can('aaaaaaaa-0000-0000-0000-000000000001','team.write')     as team_write_ожид_t,
       public.tenant_can('aaaaaaaa-0000-0000-0000-000000000001','finances.write') as finances_write_ожид_f;

\echo '--- 0081/п.1: управляющий НЕ вписывает участника ролью выше своей (ветка INSERT)'
reset role;
\set QUIET on
select test.login('f0f0f0f0-0000-0000-0000-0000000000ff');
\set QUIET off
set role authenticated;
do $$
begin
  insert into public.tenant_members (tenant_id, user_id, role)
  values ('aaaaaaaa-0000-0000-0000-000000000001','c0c0c0c0-0000-0000-0000-0000000000cc','admin');
  raise exception 'ПРОВАЛ: керуючий вписав адміністратора — ескалація через INSERT';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0081/п.1: управляющий НЕ поднимает чужую строку до роли выше своей'
do $$
begin
  update public.tenant_members set role = 'admin'
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and user_id = 'b0b0b0b0-0000-0000-0000-0000000000bb';
  raise exception 'ПРОВАЛ: керуючий підняв учасника до адміністратора';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0081/п.4: управляющий НЕ выдаёт право, которого нет у него самого'
-- finances.write есть у admin и у owner, у manager его нет ни по роли,
-- ни точечно. Ранг тут ни при чём: viewer ниже управляющего.
do $$
begin
  update public.tenant_members set permissions = '{"finances.write": true}'::jsonb
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and user_id = 'b0b0b0b0-0000-0000-0000-0000000000bb';
  raise exception 'ПРОВАЛ: керуючий видав finances.write, якого сам не має';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

reset role;
\set QUIET on
select test.login('a0a0a0a0-0000-0000-0000-0000000000aa');
\set QUIET off
set role authenticated;

\echo '--- 0081/п.4: ключ "*" в точечных правах запрещён'
do $$
begin
  update public.tenant_members set permissions = '{"*": true}'::jsonb
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and user_id = 'b0b0b0b0-0000-0000-0000-0000000000bb';
  raise exception 'ПРОВАЛ: точковим дозволом "*" видали повні права власника';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0081/п.4: нельзя выдать право, которого нет у самого актора'
do $$
begin
  update public.tenant_members set permissions = '{"finances.write": true}'::jsonb
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and user_id = 'b0b0b0b0-0000-0000-0000-0000000000bb';
  raise exception 'ПРОВАЛ: адміністратор видав finances.write, якого сам не має';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0081/п.9: себе потолок скидки не поднять'
do $$
begin
  update public.tenant_members set discount_cap_pct = 100
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and user_id = 'a0a0a0a0-0000-0000-0000-0000000000aa';
  raise exception 'ПРОВАЛ: собі підняли стелю знижки до ста відсотків';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0081/п.6: себе срок доступа не отодвинуть и не снять'
do $$
begin
  update public.tenant_members set access_expires_at = null
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and user_id = 'a0a0a0a0-0000-0000-0000-0000000000aa';
  raise exception 'ПРОВАЛ: собі зняли строк доступу';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0081/п.11: сеансы владельца админ не завершает'
do $$
begin
  perform public.end_sessions('aaaaaaaa-0000-0000-0000-000000000001',
                              '11111111-1111-1111-1111-111111111111');
  raise exception 'ПРОВАЛ: адміністратор тримає власника у вічному розлогіні';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0081/п.7: через staff у владельца не отобрать доступ'
do $$
begin
  update public.staff set blocked_at = now(), blocked_by = 'a0a0a0a0-0000-0000-0000-0000000000aa'
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and user_id = '11111111-1111-1111-1111-111111111111';
  raise exception 'ПРОВАЛ: адміністратор заблокував власника рядком staff';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

reset role;
do $$
begin
  if not public.member_access_ok('aaaaaaaa-0000-0000-0000-000000000001',
                                 '11111111-1111-1111-1111-111111111111') then
    raise exception 'ПРОВАЛ: власник втратив доступ до власного закладу';
  end if;
  raise notice 'ok — доступ власника на місці';
end $$;
set role authenticated;

\echo '--- 0081/п.5: прямая запись в invitations запрещена'
do $$
begin
  insert into public.invitations (tenant_id, email, role, permissions, token_hash, invited_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001','ghost@test','owner','{}'::jsonb,
          'deadbeefdeadbeef','a0a0a0a0-0000-0000-0000-0000000000aa');
  raise exception 'ПРОВАЛ: запрошення з роллю owner вписали прямо в таблицю';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0081/п.8: шаблон не обходит проверку ранга'
-- Шаблон делает управляющий и применяет сам: роль `admin` выше его
-- собственной, и без проверки ранга шаблон становится обходным путём.
insert into public.permission_templates (tenant_id, name, role, permissions)
  values ('aaaaaaaa-0000-0000-0000-000000000001','Хитрий шаблон','admin','{}'::jsonb)
  on conflict (tenant_id, name) do nothing;
reset role;
\set QUIET on
select test.login('f0f0f0f0-0000-0000-0000-0000000000ff');
\set QUIET off
set role authenticated;
do $$
begin
  perform public.apply_permission_template(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'b0b0b0b0-0000-0000-0000-0000000000bb',
    (select id from public.permission_templates
      where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and name = 'Хитрий шаблон'));
  raise exception 'ПРОВАЛ: шаблон видав роль, вищу за роль того, хто його застосував';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;
\set QUIET on
select test.login('a0a0a0a0-0000-0000-0000-0000000000aa');
\set QUIET off
set role authenticated;

\echo '--- 0081/п.4: ключ "*" запрещён и в шаблоне, и в приглашении'
do $$
begin
  update public.permission_templates set permissions = '{"*": true}'::jsonb
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and name = 'Хитрий шаблон';
  raise exception 'ПРОВАЛ: шаблон із ключем "*" зберігся';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

reset role;
do $$
begin
  insert into public.invitations (tenant_id, email, role, permissions, token_hash)
  values ('aaaaaaaa-0000-0000-0000-000000000001','star@test','viewer',
          '{"*": true}'::jsonb,'beefbeefbeefbeef');
  raise exception 'ПРОВАЛ: запрошення з ключем "*" зберіглося';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0081/п.1: transfer_ownership жив — флаг обхода guard читается'
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
do $$
begin
  perform public.transfer_ownership('aaaaaaaa-0000-0000-0000-000000000001',
                                    'a0a0a0a0-0000-0000-0000-0000000000aa');
exception when others then
  raise exception 'ПРОВАЛ: передача володіння зламана — %', sqlerrm;
end $$;
reset role;
select role::text as нова_роль_власника_ожид_owner from public.tenant_members
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and user_id = 'a0a0a0a0-0000-0000-0000-0000000000aa';

-- Возвращаем владение обратно: остальные проверки рассчитывают на 1111.
\set QUIET on
select test.login('a0a0a0a0-0000-0000-0000-0000000000aa');
\set QUIET off
set role authenticated;
do $$
begin
  perform public.transfer_ownership('aaaaaaaa-0000-0000-0000-000000000001',
                                    '11111111-1111-1111-1111-111111111111');
exception when others then
  raise exception 'ПРОВАЛ: зворотна передача володіння зламана — %', sqlerrm;
end $$;
reset role;

\echo '--- 0081/п.6: заблокированный НЕ разблокирует сам себя старым токеном'
-- Токен живёт до часа после того, как доступ отобрали, и в нём остаётся
-- team.write. Поэтому запрет обязан стоять в базе, а не в выдаче токена:
-- ниже claims снимаются ДО блокировки и подставляются обратно ПОСЛЕ.
\set QUIET on
select test.login('a0a0a0a0-0000-0000-0000-0000000000aa');
\set QUIET off
select current_setting('request.jwt.claims') as stale_admin \gset

\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
select public.block_member('aaaaaaaa-0000-0000-0000-000000000001',
                           'a0a0a0a0-0000-0000-0000-0000000000aa','перевірка самозвільнення');
reset role;

select set_config('request.jwt.claims', :'stale_admin', false) is not null as старий_токен_повернуто;
set role authenticated;

do $$
begin
  perform public.unblock_member('aaaaaaaa-0000-0000-0000-000000000001',
                                'a0a0a0a0-0000-0000-0000-0000000000aa');
  raise exception 'ПРОВАЛ: заблокований розблокував сам себе через unblock_member';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

do $$
begin
  update public.tenant_members set blocked_at = null, blocked_by = null, blocked_reason = null
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and user_id = 'a0a0a0a0-0000-0000-0000-0000000000aa';
  raise exception 'ПРОВАЛ: заблокований зняв собі блокування прямим UPDATE';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

reset role;
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
select public.unblock_member('aaaaaaaa-0000-0000-0000-000000000001',
                             'a0a0a0a0-0000-0000-0000-0000000000aa');
reset role;

\echo '--- 0081/п.10: один источник правды о блокировке'
-- Ставим блокировку ТОЛЬКО в staff — так её оставляла старая block_staff.
do $$
begin
  perform set_config('app.staff_block','on', true);
  update public.staff set blocked_at = now(), blocked_by = '11111111-1111-1111-1111-111111111111'
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and user_id = 'b0b0b0b0-0000-0000-0000-0000000000bb';
end $$;

do $$
begin
  if not public.member_access_ok('aaaaaaaa-0000-0000-0000-000000000001',
                                 'b0b0b0b0-0000-0000-0000-0000000000bb') then
    raise exception 'ПРОВАЛ: доступ вирішує staff.blocked_at — два джерела правди лишилися';
  end if;
  raise notice 'ok — доступ вирішує лише tenant_members.blocked_at';
end $$;

\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
do $$
begin
  perform public.unblock_member('aaaaaaaa-0000-0000-0000-000000000001',
                                'b0b0b0b0-0000-0000-0000-0000000000bb');
exception when others then
  raise exception 'ПРОВАЛ: unblock_member не знімає блокування, яке стоїть лише в staff — %', sqlerrm;
end $$;
reset role;

do $$
begin
  if exists (select 1 from public.staff s
              where s.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                and s.user_id = 'b0b0b0b0-0000-0000-0000-0000000000bb'
                and s.blocked_at is not null) then
    raise exception 'ПРОВАЛ: у картці майстра блокування лишилося';
  end if;
  raise notice 'ok — блокування зняте в обох таблицях';
end $$;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in ('block_staff','unblock_staff')) then
    raise exception 'ПРОВАЛ: block_staff/unblock_staff ще живі — два шляхи блокування';
  end if;
  raise notice 'ok — лишилися тільки block_member/unblock_member';
end $$;

\echo '--- 0081/п.5: accept_invitation перевіряє ранг запрошуючого на момент прийому'
\set QUIET on
select test.login('a0a0a0a0-0000-0000-0000-0000000000aa');
\set QUIET off
set role authenticated;
select token as inv_tok from public.create_invitation(
  'aaaaaaaa-0000-0000-0000-000000000001','newbie@test.ua','manager') \gset
reset role;
-- Токен кладём в настройку сеанса, а не в переменную psql: внутри
-- do-блока переменные psql не подставляются — он для psql одна строка.
select set_config('test.inv_token', :'inv_tok', false) is not null as токен_збережено;

-- Владелец забирает у пригласившего team.write раньше, чем письмо открыли.
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
update public.tenant_members set role = 'viewer', permissions = '{}'::jsonb
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and user_id = 'a0a0a0a0-0000-0000-0000-0000000000aa';
reset role;

\set QUIET on
select test.login('e0e0e0e0-0000-0000-0000-0000000000ee');
\set QUIET off
set role authenticated;
do $$
begin
  perform public.accept_invitation(current_setting('test.inv_token'));
  raise exception 'ПРОВАЛ: запрошення прийняте, хоча той, хто його виписав, уже без team.write';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

\echo '--- 0081/п.3: удаление аккаунта не спотыкается о журнал прав'
insert into auth.users (id, email) values
  ('d0d0d0d0-0000-0000-0000-0000000000dd','selfdelete@test')
on conflict (id) do nothing;
insert into public.tenants (id, slug, name, status)
  values ('aaaaaaaa-0000-0000-0000-00000000000d','shop-del','Магазин на видалення','active')
on conflict (id) do nothing;
insert into public.tenant_members (tenant_id, user_id, role)
  values ('aaaaaaaa-0000-0000-0000-00000000000d','d0d0d0d0-0000-0000-0000-0000000000dd','owner')
on conflict (tenant_id, user_id) do nothing;

select count(*) > 0 as запис_у_журналі_прав_ожид_t from public.permission_audit
 where tenant_id = 'aaaaaaaa-0000-0000-0000-00000000000d';

\set QUIET on
select test.login('d0d0d0d0-0000-0000-0000-0000000000dd');
\set QUIET off
set role authenticated;
do $$
begin
  perform public.delete_my_account();
exception when others then
  raise exception 'ПРОВАЛ: видалення акаунта зламане — %', sqlerrm;
end $$;
reset role;

do $$
begin
  if exists (select 1 from public.tenants where id = 'aaaaaaaa-0000-0000-0000-00000000000d') then
    raise exception 'ПРОВАЛ: заклад після видалення акаунта лишився';
  end if;
  raise notice 'ok — акаунт і заклад видалені разом із журналом прав';
end $$;

\echo '--- 0081/п.2: сторож на tenant_members ровно один'
do $$
declare n int; d text;
begin
  select count(*), string_agg(t.tgname, ', ')
    into n, d
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.tenant_members'::regclass
     and not t.tgisinternal and p.proname = 'tenant_members_guard';
  if n <> 1 then
    raise exception 'ПРОВАЛ: сторожів на tenant_members % (%), а має бути один', n, d;
  end if;
  if (select pg_get_triggerdef(t.oid) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'public.tenant_members'::regclass and not t.tgisinternal
         and p.proname = 'tenant_members_guard') not like '%INSERT%' then
    raise exception 'ПРОВАЛ: сторож не спрацьовує на INSERT — гілка ескалації відкрита';
  end if;
  raise notice 'ok — один сторож на insert/update/delete: %', d;
end $$;

\echo '--- 0081/п.12: member_access_ok не оракул для вошедших'
do $$
begin
  if has_function_privilege('authenticated','public.member_access_ok(uuid,uuid)','execute') then
    raise exception 'ПРОВАЛ: member_access_ok відкрита authenticated — це оракул «чи заблокований»';
  end if;
  if not has_function_privilege('supabase_auth_admin','public.member_access_ok(uuid,uuid)','execute') then
    raise exception 'ПРОВАЛ: хук видачі токена втратив право на member_access_ok — вхід зламано';
  end if;
  raise notice 'ok — member_access_ok лишилася службовою';
end $$;

\echo '--- 0081/п.14: хук выдачи токена доступен ровно хуку и сервису'
do $$
begin
  if has_function_privilege('anon','public.custom_access_token_hook(jsonb)','execute')
     or has_function_privilege('authenticated','public.custom_access_token_hook(jsonb)','execute') then
    raise exception 'ПРОВАЛ: custom_access_token_hook відкритий користувачам — токен збирає сам собі';
  end if;
  if not has_function_privilege('supabase_auth_admin','public.custom_access_token_hook(jsonb)','execute') then
    raise exception 'ПРОВАЛ: supabase_auth_admin не може виконати хук — вхід зламано';
  end if;
  raise notice 'ok — хук виконують лише supabase_auth_admin і service_role';
end $$;

\echo '--- 0082/А: «немає доступу» и «не працює» — разные состояния'
-- Гасим ТОЛЬКО карточку мастера: человек выпадает из расписания, но
-- кабинет ему открыт. До 0082 `team_overview` склеивала это с блокировкой
-- доступа через coalesce, и экран показывал «заблоковано» тому, у кого
-- доступ цел.
reset role;
do $$
begin
  perform set_config('app.staff_block','on', true);
  update public.staff
     set blocked_at = now(), blocked_by = '11111111-1111-1111-1111-111111111111',
         blocked_reason = 'у відпустці'
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and user_id = 'b0b0b0b0-0000-0000-0000-0000000000bb';
end $$;

\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
do $$
declare v record;
begin
  select * into v from public.team_overview('aaaaaaaa-0000-0000-0000-000000000001') t
   where t.user_id = 'b0b0b0b0-0000-0000-0000-0000000000bb';
  if v.user_id is null then
    raise exception 'ПРОВАЛ: учасника немає у складі команди';
  end if;
  if v.blocked_at is not null then
    raise exception 'ПРОВАЛ: погашена картка майстра показана як відібраний доступ — екран напише «заблоковано» тому, хто заходить';
  end if;
  if v.staff_blocked_at is null then
    raise exception 'ПРОВАЛ: «не працює» не видно взагалі — стан загублено, а не розділено';
  end if;
  if v.staff_blocked_reason <> 'у відпустці' then
    raise exception 'ПРОВАЛ: причина «не працює» підмінена причиною блокування доступу';
  end if;
  raise notice 'ok — доступ цілий, картка майстра погашена, і це два різні поля';
end $$;
reset role;

-- Доступ проверяется отдельно и НЕ от имени вошедшего: `member_access_ok`
-- с 0081 служебная, у `authenticated` права на неё нет (п. 12).
do $$
begin
  if not public.member_access_ok('aaaaaaaa-0000-0000-0000-000000000001',
                                 'b0b0b0b0-0000-0000-0000-0000000000bb') then
    raise exception 'ПРОВАЛ: погашена картка майстра відібрала доступ';
  end if;
  raise notice 'ok — «не працює» доступу не відбирає';
end $$;

\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;

-- А теперь настоящая блокировка доступа: заполниться должны ОБА признака.
select public.block_member('aaaaaaaa-0000-0000-0000-000000000001',
                           'b0b0b0b0-0000-0000-0000-0000000000bb', 'звільнення');
do $$
declare v record;
begin
  select * into v from public.team_overview('aaaaaaaa-0000-0000-0000-000000000001') t
   where t.user_id = 'b0b0b0b0-0000-0000-0000-0000000000bb';
  if v.blocked_at is null then
    raise exception 'ПРОВАЛ: відібраний доступ не видно у складі команди';
  end if;
  if v.blocked_reason <> 'звільнення' then
    raise exception 'ПРОВАЛ: причина блокування доступу не своя — %', v.blocked_reason;
  end if;
  if v.staff_blocked_at is null then
    raise exception 'ПРОВАЛ: блокування не дійшло до картки майстра — людина лишилася у розкладі';
  end if;
  raise notice 'ok — відібраний доступ і погашена картка видно кожен своїм полем';
end $$;

select public.unblock_member('aaaaaaaa-0000-0000-0000-000000000001',
                             'b0b0b0b0-0000-0000-0000-0000000000bb');
reset role;

\echo '--- 0082/Б: представления никому не отдаются на запись'
do $$
declare v_bad text;
begin
  select string_agg(distinct g.table_name || ' (' || g.grantee || ': ' || g.privilege_type || ')', ', ')
    into v_bad
    from information_schema.role_table_grants g
    join pg_class c on c.relname = g.table_name
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where g.table_schema = 'public' and c.relkind = 'v'
     and g.grantee in ('anon','authenticated','PUBLIC')
     and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
  if v_bad is not null then
    raise exception 'ПРОВАЛ: представлення відкриті на запис — %. У представлення немає RLS, а definer-представлення пише правами власника', v_bad;
  end if;
  raise notice 'ok — представлення лише читають';
end $$;
