-- 25_staff_card.sql — карточка мастера: расписание и отпуск (миграция 0101).
--
-- Проверяется ПОВЕДЕНИЕ, а не наличие объектов. «Триггер существует»
-- показывало бы зелёное и на пустом теле, и на триггере, снятом чужим
-- `create or replace` — так 0076 однажды унесла из сторожа 0052 половину
-- проверок, и никто этого не увидел.
--
-- Пять обещаний 0101, каждое отдельной попыткой:
--   1) два промежутка одного дня НЕ пересекаются;
--   2) промежутки, СОПРИКАСАЮЩИЕСЯ границей, разрешены — это обед;
--   3) запрет держится и на UPDATE, а не только на вставке;
--   4) границы отпуска считаются в часовом поясе МАСТЕРА, а не того,
--      кто заводит: два мастера в разных поясах на одни и те же даты
--      получают РАЗНЫЕ моменты времени;
--   5) отпуск нельзя завести ни чужому мастеру, ни без права.
--
-- Плюс права: ни `add_time_off`, ни триггерная функция не должны быть
-- видны анониму, а триггерная — и вошедшему тоже (урок 0094).
--
-- Файл самодостаточен и обёрнут в транзакцию с откатом: после него
-- в базе не остаётся ни одной строки, поэтому его место в run.sh
-- безразлично.

\set ON_ERROR_STOP on

begin;

grant usage on schema public to anon, authenticated;

-- Вход тем же способом, что и в 01: через настоящий хук выдачи токена,
-- а не подстановкой claims руками. Тест обязан звать то же, что зовёт
-- бой, — иначе он зелёный на форме, которая в бою ломает вход (0079).
create schema if not exists test;
create or replace function test.login(p_user uuid) returns text
language sql as $$
  select set_config('request.jwt.claims',
    (public.custom_access_token_hook(
       jsonb_build_object('user_id', p_user,
                          'claims', jsonb_build_object('sub', p_user))
     ) -> 'claims')::text, false);
$$;

insert into auth.users (id, email) values
  ('25252525-0000-0000-0000-000000000001','card-owner@test'),
  ('25252525-0000-0000-0000-000000000002','card-viewer@test'),
  ('25252525-0000-0000-0000-000000000003','card-alien@test');

insert into public.tenants (id, slug, name, kind, status, storefront_enabled,
                            listed_in_catalog, city, modules)
values ('c5c5c5c5-0000-0000-0000-000000000001','card-shop','КАРТКА','both','active',
        true, true, 'ХАРКІВ', enum_range(null::public.tenant_module)),
       ('c5c5c5c5-0000-0000-0000-000000000002','card-alien','ЧУЖИЙ','both','active',
        true, true, 'ЛЬВІВ', enum_range(null::public.tenant_module));

insert into public.tenant_members (tenant_id, user_id, role, permissions) values
  ('c5c5c5c5-0000-0000-0000-000000000001','25252525-0000-0000-0000-000000000001','owner', '{}'::jsonb),
  -- Наблюдатель: читать можно, писать нечего. Именно он проверяет, что
  -- функция спрашивает право, а не полагается на политику таблицы.
  ('c5c5c5c5-0000-0000-0000-000000000001','25252525-0000-0000-0000-000000000002','viewer',
   '{"orders.read": true}'::jsonb),
  ('c5c5c5c5-0000-0000-0000-000000000002','25252525-0000-0000-0000-000000000003','owner', '{}'::jsonb);

insert into public.staff (id, tenant_id, name, timezone) values
  ('5aff0000-0000-0000-0000-000000000001','c5c5c5c5-0000-0000-0000-000000000001','КИЇВСЬКА','Europe/Kyiv'),
  -- Второй мастер того же заведения, но в другом поясе. Так бывает
  -- у мастера, уехавшего работать за границу, — и именно на нём видно,
  -- что пояс берётся из карточки, а не из браузера администратора.
  ('5aff0000-0000-0000-0000-000000000002','c5c5c5c5-0000-0000-0000-000000000001','ЛІСАБОНСЬКА','Europe/Lisbon'),
  ('5aff0000-0000-0000-0000-000000000003','c5c5c5c5-0000-0000-0000-000000000002','ЧУЖА','Europe/Kyiv');

\set QUIET on
select test.login('25252525-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- РАСПИСАНИЕ. Пересечение промежутков
-- ─────────────────────────────────────────────────────────────────────────

\echo '--- 0101: первый промежуток дня заводится обычным путём'
insert into public.working_hours (tenant_id, staff_id, weekday, starts_at, ends_at)
values ('c5c5c5c5-0000-0000-0000-000000000001','5aff0000-0000-0000-0000-000000000001',
        1,'09:00','13:00');
select count(*) as проміжків_ожид_1 from public.working_hours
 where staff_id = '5aff0000-0000-0000-0000-000000000001';

\echo '--- 0101: соприкасающийся промежуток (обед) РАЗРЕШЁН'
insert into public.working_hours (tenant_id, staff_id, weekday, starts_at, ends_at)
values ('c5c5c5c5-0000-0000-0000-000000000001','5aff0000-0000-0000-0000-000000000001',
        1,'13:00','18:00');
select count(*) as проміжків_ожид_2 from public.working_hours
 where staff_id = '5aff0000-0000-0000-0000-000000000001';

\echo '--- 0101: пересекающийся промежуток НЕ заводится'
do $$
begin
  insert into public.working_hours (tenant_id, staff_id, weekday, starts_at, ends_at)
  values ('c5c5c5c5-0000-0000-0000-000000000001','5aff0000-0000-0000-0000-000000000001',
          1,'12:00','14:00');
  raise exception 'ПРОВАЛ: проміжки робочого дня перетнулися';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0101: тот же час в ДРУГОЙ день недели пересечением не считается'
insert into public.working_hours (tenant_id, staff_id, weekday, starts_at, ends_at)
values ('c5c5c5c5-0000-0000-0000-000000000001','5aff0000-0000-0000-0000-000000000001',
        2,'12:00','14:00');
select count(*) as проміжків_ожид_3 from public.working_hours
 where staff_id = '5aff0000-0000-0000-0000-000000000001';

\echo '--- 0101: тот же час у ДРУГОГО мастера пересечением не считается'
insert into public.working_hours (tenant_id, staff_id, weekday, starts_at, ends_at)
values ('c5c5c5c5-0000-0000-0000-000000000001','5aff0000-0000-0000-0000-000000000002',
        1,'12:00','14:00');
select count(*) as проміжків_лісабона_ожид_1 from public.working_hours
 where staff_id = '5aff0000-0000-0000-0000-000000000002';

\echo '--- 0101: запрет держится и на UPDATE, а не только на вставке'
do $$
begin
  -- Двигаем утренний промежуток так, чтобы он налез на вечерний.
  update public.working_hours set ends_at = '15:00'
   where staff_id = '5aff0000-0000-0000-0000-000000000001'
     and weekday = 1 and starts_at = '09:00';
  raise exception 'ПРОВАЛ: UPDATE провів перетин повз тригер';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- ОТПУСК. Границы считаются в часовом поясе МАСТЕРА
-- ─────────────────────────────────────────────────────────────────────────

\echo '--- 0101: отпуск заводится днями'
select public.add_time_off(
  'c5c5c5c5-0000-0000-0000-000000000001','5aff0000-0000-0000-0000-000000000001',
  'vacation','2026-08-20','2026-08-25','Канекалон закінчився') is not null as заведено_ожид_t;

\echo '--- 0101: последний день отпуска входит в него ЦЕЛИКОМ'
-- 25-е, 23:00 по Киеву — ещё отпуск. 26-е, 00:30 — уже работа.
-- Это и есть смысл верхней границы `p_to + 1` со скобкой `[)`.
select
  bool_or(t.period @> (('2026-08-25 23:00')::timestamp at time zone 'Europe/Kyiv')) as останній_день_ожид_t,
  bool_or(t.period @> (('2026-08-26 00:30')::timestamp at time zone 'Europe/Kyiv')) as наступний_день_ожид_f,
  bool_or(t.period @> (('2026-08-19 23:00')::timestamp at time zone 'Europe/Kyiv')) as переддень_ожид_f
  from public.time_off t
 where t.staff_id = '5aff0000-0000-0000-0000-000000000001';

\echo '--- 0101: тот же период у мастера в ДРУГОМ поясе даёт ДРУГИЕ моменты'
-- Главная проверка файла. Если границы считает браузер, оба отпуска
-- получатся одинаковыми, и тест покраснеет.
select public.add_time_off(
  'c5c5c5c5-0000-0000-0000-000000000001','5aff0000-0000-0000-0000-000000000002',
  'vacation','2026-08-20','2026-08-25', null) is not null as заведено_ожид_t;

select (select lower(t.period) from public.time_off t
         where t.staff_id = '5aff0000-0000-0000-0000-000000000001')
    <> (select lower(t.period) from public.time_off t
         where t.staff_id = '5aff0000-0000-0000-0000-000000000002')
       as пояси_різні_ожид_t;

\echo '--- 0101: период задом наперёд не заводится'
do $$
begin
  perform public.add_time_off(
    'c5c5c5c5-0000-0000-0000-000000000001','5aff0000-0000-0000-0000-000000000001',
    'sick','2026-09-10','2026-09-01', null);
  raise exception 'ПРОВАЛ: період задом наперед прийнято';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0101: отпуск ЧУЖОМУ мастеру не заводится даже владельцем своего заведения'
-- Подстановка чужого staff_id — то, ради чего definer-функция обязана
-- сама сверять принадлежность (правило 1), а не полагаться на политику.
do $$
begin
  perform public.add_time_off(
    'c5c5c5c5-0000-0000-0000-000000000001','5aff0000-0000-0000-0000-000000000003',
    'vacation','2026-08-20','2026-08-25', null);
  raise exception 'ПРОВАЛ: відпустку завели чужому майстрові';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0101: без права orders.write отпуск не заводится'
reset role;
\set QUIET on
select test.login('25252525-0000-0000-0000-000000000002');
\set QUIET off
set role authenticated;
do $$
begin
  perform public.add_time_off(
    'c5c5c5c5-0000-0000-0000-000000000001','5aff0000-0000-0000-0000-000000000001',
    'vacation','2026-09-01','2026-09-05', null);
  raise exception 'ПРОВАЛ: спостерігач завів відпустку';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0101: наблюдатель не правит и расписание напрямую'
do $$
declare v_n int;
begin
  update public.working_hours set ends_at = '19:00'
   where staff_id = '5aff0000-0000-0000-0000-000000000001' and weekday = 2;
  get diagnostics v_n = row_count;
  if v_n > 0 then raise exception 'ПРОВАЛ: спостерігач змінив розклад'; end if;
  raise notice 'ok — політика не віддала жодного рядка';
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────
-- ПРАВА. Ни одной новой анонимной точки входа
-- ─────────────────────────────────────────────────────────────────────────

\echo '--- 0101: add_time_off — только вошедшему, триггерная функция — никому'
select
  has_function_privilege('anon',
    'public.add_time_off(uuid,uuid,public.time_off_kind,date,date,text)','EXECUTE')
    as анонім_відпустка_ожид_f,
  has_function_privilege('authenticated',
    'public.add_time_off(uuid,uuid,public.time_off_kind,date,date,text)','EXECUTE')
    as вошедший_відпустка_ожид_t,
  has_function_privilege('anon',
    'public.working_hours_no_overlap()','EXECUTE') as анонім_тригер_ожид_f,
  has_function_privilege('authenticated',
    'public.working_hours_no_overlap()','EXECUTE') as вошедший_тригер_ожид_f;

rollback;

\echo '--- 25_staff_card: откат выполнен, база вернулась к прежнему виду'
select (select count(*) from public.tenants
         where id in ('c5c5c5c5-0000-0000-0000-000000000001',
                      'c5c5c5c5-0000-0000-0000-000000000002')) as орендарів_картки_ожид_0,
       (select count(*) from public.staff
         where tenant_id = 'c5c5c5c5-0000-0000-0000-000000000001') as майстрів_ожид_0;
