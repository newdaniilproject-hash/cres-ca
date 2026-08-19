-- 23_rate_limit.sql — ограничитель частоты в базе (миграция 0087).
--
-- Что здесь проверяется и почему именно так.
--
-- Обещание 0087 звучит как «одиннадцатый гостевой заказ (и одиннадцатая
-- запись) с одного адреса за час не проходит». Значит и проверять надо
-- ПОПЫТКОЙ нарушить: десять раз подряд успех, одиннадцатый — отказ.
-- Проверка «функция rate_hit существует» показала бы зелёное на пустом
-- теле и на неподключённом вызове.
--
-- Четыре обещания, каждое отдельной попыткой:
--   1) одиннадцатое обращение с адреса получает отказ;
--   2) десятое — проходит (предел не срабатывает раньше времени);
--   3) другой адрес считается отдельно;
--   4) заголовка нет — запись и заказ РАБОТАЮТ. Это важнее всех
--      остальных: ограничитель, который в сомнении отказывает, ломает
--      продажи первым же вызовом из psql, крона или service_role.
--
-- Плюс права: ни rate_hit, ни request_ip, ни сама таблица не должны быть
-- доступны анониму — иначе в проекте появляется девятая анонимная точка
-- входа вопреки правилу 7, и краснеет 06_isolation.sql.
--
-- Чего этот файл НЕ проверяет и почему: одновременность двух вызовов.
-- Обещание «два одновременных запроса не разойдутся» держится на том,
-- что отметка делается ОДНОЙ командой `insert … on conflict do update`,
-- то есть второй вызов ждёт блокировку строки. Проверить это из одного
-- сеанса psql нельзя, а тащить сюда второй сеанс (dblink) значит
-- заводить расширение ради одной строки. Названо явно, чтобы это
-- не выглядело забытым.
--
-- Файл самодостаточен и обёрнут в транзакцию с откатом: после него
-- в базе не остаётся ни одной строки, поэтому его место в run.sh
-- безразлично.

\set ON_ERROR_STOP on

begin;

-- Гранты те же, что в 01/06: файл обязан работать и в одиночку.
grant usage on schema public to anon, authenticated;

insert into auth.users (id, email) values
  ('17171717-0000-0000-0000-000000000001','rate-owner@test');

insert into public.tenants (id, slug, name, kind, status, storefront_enabled,
                            listed_in_catalog, city, modules)
values ('a7a7a7a7-0000-0000-0000-000000000001','rate-shop','ЧАСТОТА','both','active',
        true, true, 'ХАРКІВ', (select array_agg(code) from public.modules where is_active));

insert into public.tenant_members (tenant_id, user_id, role)
values ('a7a7a7a7-0000-0000-0000-000000000001','17171717-0000-0000-0000-000000000001','owner');

do $$
declare v_off uuid; v_var uuid; v_staff uuid;
begin
  -- Услуга: нужна длительность, иначе create_booking откажет раньше предела.
  insert into public.offerings (tenant_id, kind, status, slug, title, price, listed, published_at)
       values ('a7a7a7a7-0000-0000-0000-000000000001','service','active','rate-serv',
               'ЧАСТОТА послуга',100,true,now()) returning id into v_off;
  insert into public.offering_variants (tenant_id, offering_id, name, price,
                                        duration_minutes, buffer_minutes, track_stock)
       values ('a7a7a7a7-0000-0000-0000-000000000001', v_off,'30 хв',100,30,0,false)
       returning id into v_var;
  insert into public.staff (tenant_id, name) values
       ('a7a7a7a7-0000-0000-0000-000000000001','ЧАСТОТА майстер') returning id into v_staff;
  insert into public.staff_services (staff_id, offering_id, tenant_id)
       values (v_staff, v_off,'a7a7a7a7-0000-0000-0000-000000000001');

  -- Товар для заказов — отдельной позицией, чтобы заказы и записи
  -- не мешали друг другу.
  insert into public.offerings (tenant_id, kind, status, slug, title, price, listed, published_at)
       values ('a7a7a7a7-0000-0000-0000-000000000001','product','active','rate-item',
               'ЧАСТОТА товар',200,true,now()) returning id into v_off;
  insert into public.offering_variants (tenant_id, offering_id, name, price, track_stock)
       values ('a7a7a7a7-0000-0000-0000-000000000001', v_off,'один',200,false)
       returning id into v_var;

  create temporary table rate_fx (service_variant uuid, product_variant uuid, staff uuid)
    on commit drop;
  insert into rate_fx values (
    (select id from public.offering_variants where name = '30 хв'),
    v_var,
    (select id from public.staff where name = 'ЧАСТОТА майстер'));
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- ПРАВА. Ни одной новой анонимной точки входа
-- ─────────────────────────────────────────────────────────────────────────

\echo '--- 0087: ни счётчик, ни его функции анониму не открыты'
select has_function_privilege('anon','public.rate_hit(text,int,interval)','EXECUTE')
         as rate_hit_анониму_ожид_f,
       has_function_privilege('authenticated','public.rate_hit(text,int,interval)','EXECUTE')
         as rate_hit_користувачу_ожид_f,
       has_function_privilege('anon','public.request_ip()','EXECUTE')
         as request_ip_анониму_ожид_f,
       has_table_privilege('anon','public.rate_counters','SELECT')
         as таблиця_анониму_ожид_f,
       has_table_privilege('authenticated','public.rate_counters','SELECT')
         as таблиця_користувачу_ожид_f,
       (select relrowsecurity from pg_class
         where oid = 'public.rate_counters'::regclass) as rls_ожид_t,
       (select count(*) from pg_policies
         where schemaname = 'public' and tablename = 'rate_counters') as політик_ожид_0;

\echo '--- 0087: аноним не может позвать rate_hit сам'
-- Иначе он обходил бы предел, накручивая чужой ключ или сбрасывая свой.
do $$
begin
  execute 'set local role anon';
  perform * from public.rate_hit('order:1.2.3.4', 10, interval '1 hour');
  execute 'reset role';
  raise exception 'ПРОВАЛ: анонім викликав rate_hit напряму';
exception when others then
  execute 'reset role';
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0087: аноним не читает счётчик'
do $$
begin
  execute 'set local role anon';
  perform * from public.rate_counters;
  execute 'reset role';
  raise exception 'ПРОВАЛ: анонім прочитав rate_counters';
exception when others then
  execute 'reset role';
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- РАЗБОР ЗАГОЛОВКА. Проверено на бою: приезжает cf-connecting-ip
-- ─────────────────────────────────────────────────────────────────────────

\echo '--- 0087: request_ip() без заголовков — null, а не ошибка'
select public.request_ip() is null as без_заголовків_ожид_t;

\echo '--- 0087: cf-connecting-ip — тот заголовок, который реально приезжает'
select set_config('request.headers',
        '{"cf-connecting-ip":"203.0.113.7","x-forwarded-for":"10.0.0.1"}', true) is not null as _;
select public.request_ip() = '203.0.113.7'::inet as cf_виграє_у_xff_ожид_t;

\echo '--- 0087: без cf-connecting-ip берём ПОСЛЕДНИЙ элемент x-forwarded-for'
-- Первый элемент подделывает клиент: Cloudflare дописывает настоящий адрес
-- в конец, а не заменяет строку целиком.
select set_config('request.headers',
        '{"x-forwarded-for":"1.1.1.1, 198.51.100.9"}', true) is not null as _;
select public.request_ip() = '198.51.100.9'::inet as останній_елемент_ожид_t;

\echo '--- 0087: мусор в заголовке не роняет вызов'
select set_config('request.headers','{"cf-connecting-ip":"не-адреса"}', true) is not null as _;
select public.request_ip() is null as сміття_ожид_null;
select set_config('request.headers','ЦЕ НЕ JSON', true) is not null as _;
select public.request_ip() is null as не_json_ожид_null;

-- ─────────────────────────────────────────────────────────────────────────
-- САМ ПРЕДЕЛ
-- ─────────────────────────────────────────────────────────────────────────

\echo '--- 0087: десять проходят, одиннадцатое — отказ, и он называет срок'
do $$
declare v_ok boolean; v_wait int; i int;
begin
  for i in 1..10 loop
    select allowed, retry_after into v_ok, v_wait
      from public.rate_hit('test:203.0.113.7', 10, interval '1 hour');
    if not v_ok then
      raise exception 'ПРОВАЛ: % звернення з 10 вже отримало відмову', i;
    end if;
  end loop;
  raise notice 'ok — десять звернень пройшли';

  select allowed, retry_after into v_ok, v_wait
    from public.rate_hit('test:203.0.113.7', 10, interval '1 hour');
  if v_ok then
    raise exception 'ПРОВАЛ: одинадцяте звернення пройшло';
  end if;
  if v_wait is null or v_wait <= 0 or v_wait > 3600 then
    raise exception 'ПРОВАЛ: відмова не називає розумний строк очікування (%)', v_wait;
  end if;
  raise notice 'ok — одинадцяте відмовлено, чекати % с', v_wait;
end $$;

\echo '--- 0087: чужой адрес считается отдельно'
do $$
declare v_ok boolean;
begin
  select allowed into v_ok
    from public.rate_hit('test:198.51.100.9', 10, interval '1 hour');
  if not v_ok then
    raise exception 'ПРОВАЛ: сусідній адресі відмовили через чужий лічильник';
  end if;
  raise notice 'ok — інша адреса має власний лічильник';
end $$;

\echo '--- 0087: смысл в ключе — заказы и записи не съедают друг друга'
do $$
declare v_ok boolean;
begin
  select allowed into v_ok
    from public.rate_hit('другой-смысл:203.0.113.7', 10, interval '1 hour');
  if not v_ok then
    raise exception 'ПРОВАЛ: інший сенс з тією ж адресою впав у чужу межу';
  end if;
  raise notice 'ok — сенс у ключі розділяє лічильники';
end $$;

\echo '--- 0087: окно истекло — счёт начинается заново'
-- Отодвигаем начало окна назад: ждать час в тесте нельзя.
update public.rate_counters
   set window_start = now() - interval '61 minutes'
 where bucket = 'test:203.0.113.7';
do $$
declare v_ok boolean; v_hits int;
begin
  select allowed into v_ok
    from public.rate_hit('test:203.0.113.7', 10, interval '1 hour');
  select hits into v_hits from public.rate_counters where bucket = 'test:203.0.113.7';
  if not v_ok then raise exception 'ПРОВАЛ: після закінчення вікна досі відмова'; end if;
  if v_hits <> 1 then raise exception 'ПРОВАЛ: лічильник не скинувся, у ньому %', v_hits; end if;
  raise notice 'ok — вікно закрилося, лічильник знову 1';
end $$;

\echo '--- 0087: отказ НЕ отодвигает окно себе же'
-- Иначе тот, кто продолжает колотиться, продлевает блокировку бесконечно,
-- и честный человек за тем же NAT не дождётся её конца никогда.
-- Окно заводим вручную «начавшимся полчаса назад»: внутри одной
-- транзакции now() не движется, поэтому иначе разницы было бы не увидеть.
do $$
declare v_after timestamptz; v_wait int; v_hits int; i int;
begin
  insert into public.rate_counters (bucket, hits, window_start)
  values ('test:stubborn', 0, now() - interval '30 minutes');

  for i in 1..12 loop
    select retry_after into v_wait
      from public.rate_hit('test:stubborn', 5, interval '1 hour');
  end loop;

  select window_start, hits into v_after, v_hits
    from public.rate_counters where bucket = 'test:stubborn';

  if v_after <> now() - interval '30 minutes' then
    raise exception 'ПРОВАЛ: відмови посунули вікно вперед (%)', v_after;
  end if;
  if v_hits <> 12 then
    raise exception 'ПРОВАЛ: у вікні % звернень замість 12', v_hits;
  end if;
  -- Полчаса от начала окна уже прошло — ждать осталось около получаса,
  -- а не час: срок считается от НАЧАЛА окна, а не от последней попытки.
  if v_wait < 1750 or v_wait > 1850 then
    raise exception 'ПРОВАЛ: строк очікування рахується не від початку вікна (%)', v_wait;
  end if;
  raise notice 'ok — вікно не рухається від відмов, чекати % с', v_wait;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- ЧЕРЕЗ БОЕВЫЕ ТОЧКИ ВХОДА. Тест обязан звать то же, что зовёт бой
-- ─────────────────────────────────────────────────────────────────────────

\echo '--- 0087: гость записывается десять раз, одиннадцатый — отказ'
select set_config('request.jwt.claims','{"role":"anon"}', true) is not null as _;
select set_config('request.headers','{"cf-connecting-ip":"203.0.113.77"}', true) is not null as _;

do $$
declare i int; v_var uuid; v_staff uuid;
begin
  select service_variant, staff into v_var, v_staff from rate_fx;
  execute 'set local role anon';
  for i in 1..10 loop
    perform public.create_booking(
      'a7a7a7a7-0000-0000-0000-000000000001', v_var, v_staff,
      now() + interval '1 day' + (i * interval '1 hour'),
      'Гість ' || i, '+38050000' || lpad(i::text, 4, '0'));
  end loop;
  execute 'reset role';
  raise notice 'ok — десять записів пройшли';
exception when others then
  execute 'reset role';
  raise exception 'ПРОВАЛ: % запис з десяти впав — %', i, sqlerrm;
end $$;

do $$
declare v_var uuid; v_staff uuid;
begin
  select service_variant, staff into v_var, v_staff from rate_fx;
  execute 'set local role anon';
  perform public.create_booking(
    'a7a7a7a7-0000-0000-0000-000000000001', v_var, v_staff,
    now() + interval '3 day', 'Одинадцятий', '+380500009999');
  execute 'reset role';
  raise exception 'ПРОВАЛ: одинадцятий запис з тієї ж адреси пройшов';
exception when others then
  execute 'reset role';
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0087: отказ не оставил после себя ни записи, ни карточки клиента'
-- Предел стоит ДО первой вставки. Иначе отказ съедал бы номер записи
-- и плодил карточки-призраки на каждую попытку бота.
select count(*) as записів_ожид_10 from public.bookings
 where tenant_id = 'a7a7a7a7-0000-0000-0000-000000000001';
select count(*) as карточок_ожид_10 from public.customers
 where tenant_id = 'a7a7a7a7-0000-0000-0000-000000000001';

\echo '--- 0087: другой адрес пишется свободно'
select set_config('request.headers','{"cf-connecting-ip":"198.51.100.55"}', true) is not null as _;
do $$
declare v_var uuid; v_staff uuid; v_num bigint;
begin
  select service_variant, staff into v_var, v_staff from rate_fx;
  execute 'set local role anon';
  select number into v_num from public.create_booking(
    'a7a7a7a7-0000-0000-0000-000000000001', v_var, v_staff,
    now() + interval '4 day', 'Сусід', '+380500008888');
  execute 'reset role';
  if v_num is null then raise exception 'ПРОВАЛ: сусідня адреса не змогла записатися'; end if;
  raise notice 'ok — сусідня адреса записалася, номер %', v_num;
exception when others then
  execute 'reset role';
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise exception 'ПРОВАЛ: сусідня адреса впала — %', sqlerrm;
end $$;

\echo '--- 0087: заголовка нет вовсе — запись НЕ ломается'
-- Главная проверка файла. Так зовут функцию psql, крон, service_role
-- и всё, что не PostgREST. Отказ здесь убил бы запись клиентам разом.
select set_config('request.headers','', true) is not null as _;
do $$
declare i int; v_var uuid; v_staff uuid;
begin
  select service_variant, staff into v_var, v_staff from rate_fx;
  execute 'set local role anon';
  for i in 1..15 loop
    perform public.create_booking(
      'a7a7a7a7-0000-0000-0000-000000000001', v_var, v_staff,
      now() + interval '10 day' + (i * interval '1 hour'),
      'Без заголовка ' || i, '+38066000' || lpad(i::text, 4, '0'));
  end loop;
  execute 'reset role';
  raise notice 'ok — пʼятнадцять записів без заголовка пройшли, межа не спрацювала';
exception when others then
  execute 'reset role';
  raise exception 'ПРОВАЛ: без заголовка запис зламався на % — %', i, sqlerrm;
end $$;

\echo '--- 0087: то же самое для заказов — одиннадцатый отказан'
select set_config('request.headers','{"cf-connecting-ip":"203.0.113.99"}', true) is not null as _;
do $$
declare i int; v_var uuid;
begin
  select product_variant into v_var from rate_fx;
  execute 'set local role anon';
  for i in 1..10 loop
    perform public.create_order(
      'a7a7a7a7-0000-0000-0000-000000000001',
      jsonb_build_array(jsonb_build_object('variant_id', v_var, 'quantity', 1)),
      'Покупець ' || i, '+38063000' || lpad(i::text, 4, '0'));
  end loop;
  execute 'reset role';
  raise notice 'ok — десять замовлень пройшли';
exception when others then
  execute 'reset role';
  raise exception 'ПРОВАЛ: % замовлення з десяти впало — %', i, sqlerrm;
end $$;

do $$
declare v_var uuid;
begin
  select product_variant into v_var from rate_fx;
  execute 'set local role anon';
  perform public.create_order(
    'a7a7a7a7-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('variant_id', v_var, 'quantity', 1)),
    'Одинадцятий покупець', '+380639999999');
  execute 'reset role';
  raise exception 'ПРОВАЛ: одинадцяте замовлення з тієї ж адреси пройшло';
exception when others then
  execute 'reset role';
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0087: заказ без заголовка проходит и на двенадцатый раз'
select set_config('request.headers','', true) is not null as _;
do $$
declare i int; v_var uuid;
begin
  select product_variant into v_var from rate_fx;
  execute 'set local role anon';
  for i in 1..12 loop
    perform public.create_order(
      'a7a7a7a7-0000-0000-0000-000000000001',
      jsonb_build_array(jsonb_build_object('variant_id', v_var, 'quantity', 1)),
      'Без заголовка ' || i, '+38067000' || lpad(i::text, 4, '0'));
  end loop;
  execute 'reset role';
  raise notice 'ok — дванадцять замовлень без заголовка пройшли';
exception when others then
  execute 'reset role';
  raise exception 'ПРОВАЛ: без заголовка замовлення зламалось на % — %', i, sqlerrm;
end $$;

\echo '--- 0087: сотрудник заведения под предел не попадает'
-- Названное отступление от «10 в час на адрес» (шапка 0087): салон
-- заводит ручные заказы с одного офисного адреса, и одиннадцатый заказ
-- администратора не должен упираться в границу, написанную против ботов.
select set_config('request.headers','{"cf-connecting-ip":"203.0.113.99"}', true) is not null as _;
select set_config('request.jwt.claims',
  (public.custom_access_token_hook(
     jsonb_build_object('user_id','17171717-0000-0000-0000-000000000001',
                        'claims', jsonb_build_object('sub','17171717-0000-0000-0000-000000000001'))
   ) -> 'claims')::text, true) is not null as _;
do $$
declare i int; v_var uuid;
begin
  select product_variant into v_var from rate_fx;
  execute 'set local role authenticated';
  -- Адрес 203.0.113.99 уже исчерпан гостями выше — сотруднику это не мешает.
  for i in 1..5 loop
    perform public.create_order(
      'a7a7a7a7-0000-0000-0000-000000000001',
      jsonb_build_array(jsonb_build_object('variant_id', v_var, 'quantity', 1)),
      'Ручне замовлення ' || i, '+38068000' || lpad(i::text, 4, '0'));
  end loop;
  execute 'reset role';
  raise notice 'ok — співробітник заводить замовлення з вичерпаної адреси';
exception when others then
  execute 'reset role';
  raise exception 'ПРОВАЛ: співробітник упёрся в межу для гостей — %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- УБОРКА
-- ─────────────────────────────────────────────────────────────────────────

\echo '--- 0087: задание уборки заведено ровно одно и разбирается'
select jobname as завдання, count(*) as штук_ожид_1, bool_and(active) as живе_ожид_t
  from cron.job where jobname = 'rate-counters-sweep' group by jobname;

select (schedule = '17 * * * *')                       as розклад_ожид_t,
       (command like '%delete from public.rate_counters%') as прибирає_ожид_t,
       (command like '%24 hours%')                     as строк_ожид_t
  from cron.job where jobname = 'rate-counters-sweep';

\echo '--- 0087: тело задания действительно уносит старые строки и не трогает свежие'
-- Исполняется ровно тот текст, что лежит в базе, а не его пересказ.
insert into public.rate_counters (bucket, hits, window_start)
values ('test:старий', 3, now() - interval '2 days'),
       ('test:свіжий', 3, now() - interval '10 minutes');
do $$ declare v_cmd text; begin
  select command into v_cmd from cron.job where jobname = 'rate-counters-sweep';
  execute v_cmd;
end $$;
select (select count(*) from public.rate_counters where bucket = 'test:старий') as старий_ожид_0,
       (select count(*) from public.rate_counters where bucket = 'test:свіжий') as свіжий_ожид_1;

rollback;

\echo '--- 23_rate_limit: откат выполнен, база вернулась к прежнему виду'
select count(*) as орендарів_частоти_ожид_0 from public.tenants
 where id = 'a7a7a7a7-0000-0000-0000-000000000001';
