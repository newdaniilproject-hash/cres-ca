-- 18_notify_delivery.sql — доставка уведомлений (миграция 0023, механика
-- очереди — 0011, оживление отменённых — 0047).
--
-- 0023 восстановлена из боевой базы: файла не было в репозитории, хотя
-- миграция применена. Тем важнее иметь на неё сценарий — иначе следующий
-- `create or replace` снесёт её содержимое так же тихо, как 0076 снесла
-- сторожа из 0052.
--
-- Что обещано и проверяется попыткой нарушить:
--   • Viber и SMS не подключены — обречённые попытки не копятся;
--   • новый заказ поднимает письмо продавцу с нужным правом, и только ему;
--   • попытки СЧИТАЮТСЯ, неудача ОТКЛАДЫВАЕТ, пятая делает строку failed;
--   • повторная постановка того же ключа не задваивает отправку.
--
-- Чего здесь нет и почему: канал 'inapp' закрывает сам обработчик
-- (app/api/cron/notifications/route.ts: строка «сама и есть уведомление»,
-- отдельной отправки не требует). Из SQL это не видно — база даёт для
-- этого ровно один кирпич, notification_mark(p_ok => true), и он ниже
-- проверен: строка закрывается без единой внешней отправки.

\set ON_ERROR_STOP on

\echo '--- 0023: шаблонов Viber и SMS не осталось ни одного'
-- Каналы не подключены. Живой шаблон означал бы, что триггер поставит
-- в очередь письмо, которое некому отправить, и обработчик будет
-- перебирать его пять раз, пока не пометит failed.
select count(*) as viber_sms_шаблонів_ожид_0
  from public.notification_templates where channel in ('viber','sms');
select count(*) as viber_sms_у_черзі_ожид_0
  from public.notification_outbox where channel in ('viber','sms') and status = 'pending';

\echo '--- 0023: стартовые украинские шаблоны на месте и с подстановками'
select event as подія, channel as канал,
       (body like '%{{%') as є_підстановка_ожид_t,
       (locale = 'uk')    as мова_ожид_t
  from public.notification_templates
 where tenant_id is null
   and event in ('booking.created','booking.reminder_24h','seller.order_created')
   and channel = 'email'
 order by event;

\echo '--- 0023: новый заказ поднимает письмо продавцу с правом orders.read'
-- Заказ оформляется тем же путём, что и в бою: гость зовёт create_order.
\set QUIET on
select set_config('request.jwt.claims', '{}', false);
\set QUIET off
set role anon;
select (o.number is not null) as замовлення_створено_ожид_t
  from public.create_order(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '[{"variant_id":"cccccccc-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
    'Оксана Тест', '+380509998877', 'Oksana@Test.ua'
  ) o;
reset role;

select count(*) filter (where user_id = '11111111-1111-1111-1111-111111111111') > 0
         as власнику_ожид_t,
       count(*) filter (where user_id = '44444444-4444-4444-4444-444444444444')
         as інспектору_ожид_0,
       count(*) filter (where to_email is null)
         as листів_без_адреси_ожид_0
  from public.notification_outbox
 where event = 'seller.order_created'
   and ref_id = (select id from public.orders where contact_name = 'Оксана Тест');

\echo '--- 0023/0028: почта покупателя доезжает до очереди как есть'
-- 0028 чинила ровно это: адрес приводился к text и на пути от объявления
-- к вызову терял тип, отчего письмо покупателю не ставилось вовсе.
select count(*) > 0 as лист_покупцю_ожид_t
  from public.notification_outbox
 where event = 'order.created' and channel = 'email'
   and ref_id = (select id from public.orders where contact_name = 'Оксана Тест')
   and to_email is not null;

\echo '--- 0011: повторная постановка того же ключа не задваивает отправку'
-- Обработчик может запуститься дважды, триггер может сработать на UPDATE
-- без смены статуса. Ключ дедупликации обязан удержать одну строку.
do $$
declare v_tenant uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; v_before bigint; v_after bigint;
begin
  select count(*) into v_before from public.notification_outbox
   where tenant_id = v_tenant and dedupe_key = 'test:dedupe:1';
  perform public.enqueue_notification(
    v_tenant, 'order.created', 'email', 'test:dedupe:1',
    '{"number":"1"}'::jsonb, null, null, null, null,
    'dup@test.ua'::extensions.citext, 'order', null, 'uk');
  perform public.enqueue_notification(
    v_tenant, 'order.created', 'email', 'test:dedupe:1',
    '{"number":"1"}'::jsonb, null, null, null, null,
    'dup@test.ua'::extensions.citext, 'order', null, 'uk');
  select count(*) into v_after from public.notification_outbox
   where tenant_id = v_tenant and dedupe_key = 'test:dedupe:1';
  if v_after <> 1 then
    raise exception 'ПРОВАЛ: під одним ключем дедуплікації % рядків замість одного', v_after;
  end if;
  raise notice 'ok — під ключем рівно один рядок (було %)', v_before;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Механика попыток. Работает от сервисной роли — это разрешённое место
-- (правило 3: сервисный ключ только в фоновых задачах).
-- ─────────────────────────────────────────────────────────────────────────

\echo '--- 0011: попытки СЧИТАЮТСЯ — каждый проход обработчика +1'
do $$
declare v_id uuid; v_a1 int; v_a2 int;
begin
  select id into v_id from public.notification_outbox where dedupe_key = 'test:dedupe:1';
  perform public.notifications_take(50);
  select attempts into v_a1 from public.notification_outbox where id = v_id;
  -- Возвращаем строку в «пора отправлять», чтобы второй проход её взял.
  update public.notification_outbox set send_after = now() - interval '1 minute' where id = v_id;
  perform public.notifications_take(50);
  select attempts into v_a2 from public.notification_outbox where id = v_id;
  if v_a1 <> 1 or v_a2 <> 2 then
    raise exception 'ПРОВАЛ: спроби не рахуються — після першого проходу %, після другого %', v_a1, v_a2;
  end if;
  raise notice 'ok — спроби: % → %', v_a1, v_a2;
end $$;

\echo '--- 0011: неудача ОТКЛАДЫВАЕТ, а не хоронит'
-- Письмо, не ушедшее из-за пятисекундной недоступности почтовика, обязано
-- уйти позже. Поэтому статус остаётся pending, а send_after уезжает вперёд.
do $$
declare v_id uuid; v_status text; v_after timestamptz; v_err text;
begin
  select id into v_id from public.notification_outbox where dedupe_key = 'test:dedupe:1';
  perform public.notification_mark(v_id, false, 'Resend 502');
  select status::text, send_after, last_error into v_status, v_after, v_err
    from public.notification_outbox where id = v_id;
  if v_status <> 'pending' then
    raise exception 'ПРОВАЛ: після однієї невдачі статус «%», а не pending', v_status;
  end if;
  if v_after <= now() then
    raise exception 'ПРОВАЛ: невдала спроба не відклала відправку (send_after = %)', v_after;
  end if;
  if v_err is null then
    raise exception 'ПРОВАЛ: причина невдачі не записана';
  end if;
  raise notice 'ok — pending, наступна спроба через %, причина: %', v_after - now(), v_err;
end $$;

\echo '--- 0011: на пятой попытке строка становится failed и перестаёт греметь'
do $$
declare v_id uuid; v_status text; v_att int;
begin
  select id into v_id from public.notification_outbox where dedupe_key = 'test:dedupe:1';
  for i in 1..5 loop
    update public.notification_outbox
       set send_after = now() - interval '1 minute' where id = v_id;
    perform public.notifications_take(50);
    perform public.notification_mark(v_id, false, 'Resend 502');
  end loop;
  select status::text, attempts into v_status, v_att
    from public.notification_outbox where id = v_id;
  if v_status <> 'failed' then
    raise exception 'ПРОВАЛ: після % спроб статус «%», а не failed', v_att, v_status;
  end if;
  raise notice 'ok — після % спроб рядок failed', v_att;
end $$;

\echo '--- 0011: failed обработчик больше не берёт'
do $$
declare v_id uuid; v_att_before int; v_att_after int;
begin
  select id, attempts into v_id, v_att_before
    from public.notification_outbox where dedupe_key = 'test:dedupe:1';
  update public.notification_outbox set send_after = now() - interval '1 hour' where id = v_id;
  perform public.notifications_take(50);
  select attempts into v_att_after from public.notification_outbox where id = v_id;
  if v_att_after <> v_att_before then
    raise exception 'ПРОВАЛ: обробник узяв рядок зі статусом failed';
  end if;
  raise notice 'ok — failed більше не береться';
end $$;

\echo '--- 0011: успех закрывает строку без единой внешней отправки'
-- Тот же кирпич использует обработчик для канала inapp: строка САМА
-- и есть уведомление, отправлять её некуда, она просто закрывается.
do $$
declare v_id uuid; v_status text; v_sent timestamptz;
begin
  perform public.enqueue_notification(
    'aaaaaaaa-0000-0000-0000-000000000001', 'order.created', 'inapp', 'test:inapp:1',
    '{"number":"1"}'::jsonb, null, '11111111-1111-1111-1111-111111111111',
    null, null, null, 'order', null, 'uk');
  select id into v_id from public.notification_outbox where dedupe_key = 'test:inapp:1';
  perform public.notifications_take(50);
  perform public.notification_mark(v_id, true);
  select status::text, sent_at into v_status, v_sent
    from public.notification_outbox where id = v_id;
  if v_status <> 'sent' or v_sent is null then
    raise exception 'ПРОВАЛ: рядок не закрився — статус «%», sent_at %', v_status, v_sent;
  end if;
  raise notice 'ok — inapp закрито відміткою, час %', v_sent;
end $$;

\echo '--- 0011: очередь не отдаётся пользователю'
-- notifications_take и notification_mark отозваны у public/anon/authenticated:
-- иначе покупатель мог бы пометить чужое письмо отправленным и оно бы
-- не ушло вовсе.
set role authenticated;
do $$
begin
  perform public.notifications_take(1);
  raise exception 'ПРОВАЛ: чергу уведомлень забрав звичайний користувач';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

do $$
begin
  perform public.notification_mark(
    (select id from public.notification_outbox limit 1), true);
  raise exception 'ПРОВАЛ: звичайний користувач позначив уведомлення відправленим';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

\echo '--- 0023: отменённая запись гасит свои неотправленные напоминания'
-- Напоминание «завтра о 10:00» про отменённую запись — худший вид письма:
-- клиент придёт.
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
update public.bookings set status = 'cancelled', cancel_reason = 'тест'
 where id = (select id from public.bookings
              where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                and status not in ('cancelled','no_show')
              order by created_at limit 1);
reset role;

select count(*) as живих_нагадувань_ожид_0
  from public.notification_outbox
 where ref_type = 'booking' and status = 'pending'
   and ref_id in (select id from public.bookings where status = 'cancelled');
