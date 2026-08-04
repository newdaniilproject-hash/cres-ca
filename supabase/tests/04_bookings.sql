-- 04_bookings.sql — запись на услуги, уведомления, ключи интеграций.
-- Продолжает данные 01-03 (магазин shop-one, витрина опубликована).

\set ON_ERROR_STOP on
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off

\echo '--- заводим услугу, мастера и график'
insert into public.offerings (id, tenant_id, kind, status, slug, title, price, deposit_percent)
values ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',
        'service','active','manikur','Манікюр', 800, 30);

\echo '--- вариант услуги без длительности обязан упасть'
do $$ begin
  insert into public.offering_variants (tenant_id, offering_id, name, price)
  values ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002',
          'Без часу', 800);
  raise exception 'ПРОВАЛ: услуга без длительности прошла';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- товар с длительностью тоже обязан упасть'
do $$ begin
  insert into public.offering_variants (tenant_id, offering_id, name, price, duration_minutes)
  values ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
          'L', 3000, 60);
  raise exception 'ПРОВАЛ: у товара появилась длительность';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

insert into public.offering_variants
  (id, tenant_id, offering_id, name, price, duration_minutes, buffer_minutes)
values ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000002','Класичний, 60 хв', 800, 60, 15);

insert into public.staff (id, tenant_id, name, title)
values ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
        'Оля','майстер манікюру');

-- Работает все семь дней с 09:00 до 19:00, чтобы тест не зависел от дня недели.
insert into public.working_hours (tenant_id, staff_id, weekday, starts_at, ends_at)
select 'aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
       d, '09:00','19:00' from generate_series(0,6) d;

\echo '--- слоты считаются, а не хранятся: на завтра их должно быть много'
select count(*) > 10 as слотов_достаточно
  from public.available_slots(
    'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',
    (current_date + 1), (current_date + 1));

\echo '--- гость записывается по ссылке, депозит 30% считается сам'
\set QUIET on
select set_config('request.jwt.claims', '{}', false);
\set QUIET off
set role anon;
select b.number as номер_ожид_1, b.price as цена_ожид_800,
       b.deposit_due as депозит_ожид_240, b.status
  from public.create_booking(
    'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',
    'eeeeeeee-0000-0000-0000-000000000001',
    (current_date + 1 + time '10:00') at time zone 'Europe/Kyiv',
    'Марія Клієнт','+380671234567') b;

\echo '--- второй клиент на то же время обязан получить отказ от БАЗЫ'
do $$ begin
  perform public.create_booking(
    'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',
    'eeeeeeee-0000-0000-0000-000000000001',
    (current_date + 1 + time '10:00') at time zone 'Europe/Kyiv',
    'Інша Людина','+380670000000');
  raise exception 'ПРОВАЛ: двойное бронирование прошло';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- пересечение с буфером тоже занято: 10:30 при услуге 60+15 мин'
do $$ begin
  perform public.create_booking(
    'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',
    'eeeeeeee-0000-0000-0000-000000000001',
    (current_date + 1 + time '10:30') at time zone 'Europe/Kyiv',
    'Третій','+380670000001');
  raise exception 'ПРОВАЛ: наложение на буфер прошло';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- занятый слот исчез из выдачи слотов'
select count(*) as слот_10_00_ожид_0
  from public.available_slots(
    'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',
    (current_date + 1), (current_date + 1)) s
 where s.starts_at = (current_date + 1 + time '10:00') at time zone 'Europe/Kyiv';

reset role;

\echo '--- при записи сразу поставлены подтверждение и два напоминания'
select event, channel,
       (send_after > now()) as в_будущем
  from public.notification_outbox
 where ref_type = 'booking' order by send_after;

\echo '--- отпуск мастера закрывает время'
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
insert into public.time_off (tenant_id, staff_id, kind, period)
values ('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','vacation',
        tstzrange((current_date + 2 + time '00:00') at time zone 'Europe/Kyiv',
                  (current_date + 3 + time '00:00') at time zone 'Europe/Kyiv','[)'));

select count(*) as слотов_в_отпуске_ожид_0
  from public.available_slots(
    'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',
    (current_date + 2), (current_date + 2));

\echo '--- отмена записи гасит неотправленные напоминания'
do $$ declare v_id uuid; begin
  select id into v_id from public.bookings where number = 1;
  perform public.set_booking_status(v_id, 'cancelled', 'клієнт захворів');
end $$;

select count(*) filter (where status = 'cancelled') as погашено,
       count(*) filter (where status = 'pending' and event like 'booking.reminder%') as осталось_ожид_0
  from public.notification_outbox where ref_type = 'booking';

\echo '--- освободившееся время снова доступно'
select count(*) as слот_снова_свободен_ожид_1
  from public.available_slots(
    'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',
    (current_date + 1), (current_date + 1)) s
 where s.starts_at = (current_date + 1 + time '10:00') at time zone 'Europe/Kyiv';

\echo '--- склад: порог, поставщик, сканер'
insert into public.storage_locations (id, tenant_id, name)
values ('ffffffff-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Полиця А1');

update public.offering_variants
   set min_stock_threshold = 20, barcode = '4820000000017',
       location_id = 'ffffffff-0000-0000-0000-000000000001'
 where id = 'cccccccc-0000-0000-0000-000000000001';

select kind, title, subtitle, stock_qty, location, low_stock as мало_ожид_t
  from public.scan_lookup('aaaaaaaa-0000-0000-0000-000000000001', '4820000000017');

select kind, title, to_order as закупить
  from public.stock_low_view where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';

select units, cost_value, retail_value
  from public.stock_value_view where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';

\echo '--- ключ интеграции: пишется, наружу не читается'
select provider, status, secret_hint as хвост_ожид_последние_4
  from public.set_integration_secret(
    'aaaaaaaa-0000-0000-0000-000000000001','nova_poshta',
    'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    '{"city":"Харків","sender":"ФОП Іванов"}'::jsonb);

\echo '--- в таблице интеграций самого ключа нет — только ссылка'
select (secret_id is not null) as ссылка_есть,
       (to_jsonb(i.*) ? 'secret') as ключ_в_таблице_ожид_f
  from public.integrations i limit 1;

\echo '--- подмена ссылки на чужой ключ обычным UPDATE обязана упасть'
do $$ begin
  update public.integrations set secret_id = gen_random_uuid();
  raise exception 'ПРОВАЛ: ключ подменили напрямую';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- накладная проставляется в заказ сама'
do $$ declare v_order uuid; begin
  select id into v_order from public.orders where number = 2;
  insert into public.shipments (tenant_id, order_id, ttn, recipient_city, recipient_branch, created_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001', v_order, '20450000000001',
          'Харків','47','11111111-1111-1111-1111-111111111111');
end $$;

select number, tracking_number as ттн_в_заказе from public.orders where number = 2;

-- ─────────────────────────────────────────────────────────────────────────────
-- Проверка 0013: посторонний не читает данные чужого магазина
-- ─────────────────────────────────────────────────────────────────────────────
\echo '--- закрываем витрину и проверяем, что снаружи не видно ничего'
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
update public.tenants set storefront_enabled = false
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';

\set QUIET on
select set_config('request.jwt.claims', '{}', false);
\set QUIET off
set role anon;
select (select count(*) from public.working_hours)     as графиков_ожид_0,
       (select count(*) from public.staff)             as мастеров_ожид_0,
       (select count(*) from public.staff_services)    as услуг_мастера_ожид_0,
       (select count(*) from public.collection_items)  as подборок_ожид_0;

\echo '--- себестоимость склада анониму недоступна'
do $$ declare n int; begin
  select count(*) into n from public.stock_value_view;
  raise exception 'ПРОВАЛ: аноним прочитал оценку склада (% строк)', n;
exception when insufficient_privilege then
  raise notice 'ok — %', sqlerrm; end $$;
reset role;

\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
update public.tenants set storefront_enabled = true
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
