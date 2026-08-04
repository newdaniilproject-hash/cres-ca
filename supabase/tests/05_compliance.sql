-- 05_compliance.sql — санитарный модуль: партии, PAO, журналы, инспектор.
-- Продолжает данные 01-04.

\set ON_ERROR_STOP on
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off

\echo '--- косметический паспорт и партия'
update public.materials
   set is_cosmetic = true, brand = 'BraidPro', pao_months = 12,
       notification_code = 'UA-COSM-2026-001122'
 where id = 'dddddddd-0000-0000-0000-000000000001';

insert into public.material_batches
  (id, tenant_id, material_id, batch_number, expiry_date, created_by)
values ('abcd0000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001','LOT-2026-08',
        current_date + 400, '11111111-1111-1111-1111-111111111111');

\echo '--- вскрытие банки: use_by = вскрытие + PAO (12 мес < срока партии)'
insert into public.material_containers
  (id, tenant_id, material_id, batch_id, code, status, created_by)
values ('abcd0000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001','abcd0000-0000-0000-0000-000000000001',
        'CNT-001','opened','11111111-1111-1111-1111-111111111111');

select status, opened_at is not null as вскрыта,
       use_by = (opened_at + interval '12 months')::date as pao_считан_ожид_t,
       use_by < current_date + 400 as pao_раньше_партии_ожид_t
  from public.material_containers where code = 'CNT-001';

\echo '--- предупреждения за 14 и 7 дней поставлены в очередь, в будущем'
select event, (send_after > now()) as в_будущем,
       (send_after::date = use_by - 14 or send_after::date = use_by - 7) as дата_верна
  from public.notification_outbox o
  join public.material_containers c on c.id = o.ref_id
 where o.ref_type = 'container' order by o.send_after;

\echo '--- дату вскрытия нельзя переписать'
do $$ begin
  update public.material_containers set opened_at = now() - interval '1 year'
   where code = 'CNT-001';
  raise exception 'ПРОВАЛ: вскрытие переписали задним числом';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- розлив в дозатор: своя наклейка, свой PAO'
insert into public.material_containers
  (tenant_id, material_id, batch_id, code, parent_id, volume, unit, status, pao_months, created_by)
values ('aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001',
        'abcd0000-0000-0000-0000-000000000001','CNT-001-A',
        'abcd0000-0000-0000-0000-000000000002', 250,'мл','opened', 3,
        '11111111-1111-1111-1111-111111111111');

select code, use_by = (opened_at + interval '3 months')::date as дозатор_3_мес_ожид_t
  from public.material_containers where code = 'CNT-001-A';

\echo '--- сканер ёмкости по наклейке'
select material, code, status, days_left > 0 as годна, batch_number
  from public.scan_container('aaaaaaaa-0000-0000-0000-000000000001','CNT-001-A');

\echo '--- журнал дезрастворов: пишется, не правится, не удаляется'
insert into public.sanitation_solutions
  (tenant_id, agent_name, registration, concentration, volume, expires_at, prepared_by)
values ('aaaaaaaa-0000-0000-0000-000000000001','Бланідас-Актив','№ 0525-2024','0,5%',5,
        now() + interval '7 days','11111111-1111-1111-1111-111111111111');

do $$ begin
  update public.sanitation_solutions set concentration = '5%';
  raise exception 'ПРОВАЛ: журнал дезинфекции отредактировали';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

do $$ begin
  delete from public.sanitation_solutions;
  raise exception 'ПРОВАЛ: журнал дезинфекции очистили';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- стерилизация: провал индикатора — тоже запись'
insert into public.sterilization_cycles
  (tenant_id, device, temperature_c, duration_minutes, indicator_ok, performed_by)
values ('aaaaaaaa-0000-0000-0000-000000000001','сухожарова шафа',180,60,true,
        '11111111-1111-1111-1111-111111111111'),
       ('aaaaaaaa-0000-0000-0000-000000000001','сухожарова шафа',160,45,false,
        '11111111-1111-1111-1111-111111111111');
select count(*) as циклов_ожид_2,
       count(*) filter (where not indicator_ok) as провалов_ожид_1
  from public.sterilization_cycles;

\echo '--- техкарта: утверждённая версия неизменна'
insert into public.tech_cards (tenant_id, title, steps, approved_by)
values ('aaaaaaaa-0000-0000-0000-000000000001','Підготовка канекалону',
        '[{"step":"вимочування","solution":"оцтовий розчин","proportion":"1:10","minutes":15}]',
        '11111111-1111-1111-1111-111111111111');

do $$ begin
  update public.tech_cards set steps = '[]'::jsonb;
  raise exception 'ПРОВАЛ: техкарту переписали без новой версии';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- ИНСПЕКТОР: видит реестр и журналы, не видит клиентов и деньги'
insert into auth.users (id, email) values
  ('44444444-4444-4444-4444-444444444444','inspector@dpss.gov.ua');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444','inspector');

\set QUIET on
select test.login('44444444-4444-4444-4444-444444444444');
\set QUIET off
set role authenticated;

select (select count(*) from public.material_batches)      as партии_ожид_1,
       (select count(*) from public.material_containers)   as емкости_ожид_2,
       (select count(*) from public.sanitation_solutions)  as дезжурнал_ожид_1,
       (select count(*) from public.sterilization_cycles)  as стерилизация_ожид_2,
       (select count(*) from public.tech_cards)            as техкарты_ожид_1,
       (select count(*) from public.customers)             as клиентов_ожид_0,
       (select count(*) from public.orders)                as заказов_ожид_0,
       (select count(*) from public.finance_records)       as финансов_ожид_0,
       (select count(*) from public.bookings)              as записей_ожид_0;

\echo '--- инспектор не может писать: даже отметку дезинфекции'
do $$ begin
  insert into public.sanitation_solutions
    (tenant_id, agent_name, concentration, volume, expires_at, prepared_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001','Х','1%',1,
          now() + interval '1 day','44444444-4444-4444-4444-444444444444');
  raise exception 'ПРОВАЛ: инспектор записал в журнал';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;
reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0016: поиск, карта, самостоятельная регистрация
-- ─────────────────────────────────────────────────────────────────────────────
\echo '--- поиск: находит магазин и услугу, терпит опечатку'
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
update public.tenants set city = 'Харків', lat = 49.9935, lng = 36.2304,
       listed_in_catalog = true
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';

\set QUIET on
select set_config('request.jwt.claims', '{}', false);
\set QUIET off
set role anon;
select result_type, title from public.search_all('манікюр') limit 3;
select count(*) as рус_написание_ожид_больше_0 from public.search_all('маникюр');
select result_type as магазин_по_имени from public.search_all('Магазин 1') limit 1;

\echo '--- карта отдаёт магазин с координатами'
select name, city, lat is not null as есть_гео from public.map_tenants();
select city, shops from public.active_cities();

\echo '--- витрина одной функцией'
select (public.storefront('shop-one')->'shop'->>'name') as имя,
       jsonb_array_length(public.storefront('shop-one')->'offerings') as позиций,
       jsonb_array_length(public.storefront('shop-one')->'staff') as мастеров;
reset role;

\echo '--- самостоятельная регистрация: магазин + владелец одной транзакцией'
\set QUIET on
select test.login('33333333-3333-3333-3333-333333333333');
\set QUIET off
select (r.status = 'draft') as черновик_ожид_t,
       length(r.slug::text) >= 3 as слаг_создан
  from public.register_tenant('Салон Плетіння Кіс', 'services', 'Харків') r;

select tm.role as роль_ожид_owner
  from public.tenant_members tm
  join public.tenants t on t.id = tm.tenant_id
 where tm.user_id = '33333333-3333-3333-3333-333333333333' and t.name = 'Салон Плетіння Кіс';
