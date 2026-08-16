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

-- ═══════════════════════════════════════════════════════════════════════════
-- ИНСПЕКТОР целиком: «видит реестр, журналы и документы, но не видит
-- ни клиентов, ни заказов, ни денег, и не пишет никуда» (CLAUDE.md).
--
-- ПОЧЕМУ ЭТОТ БЛОК ПЕРЕПИСАН. Прежняя версия печатала девять счётчиков
-- и НИЧЕГО не сверяла: ожидание жило в ИМЕНИ колонки («партии_ожид_1»),
-- а run.sh грепает только слово ПРОВАЛ. После 0043, закрывшей
-- `material_batches` на `stock.read`, эта строка печатала
-- «партии_ожид_1 = 0» — и прогон оставался зелёным ровно в том месте,
-- где у роли отобрали право. Стенд проверял не то, что в бою, и молчал
-- об этом полгода миграций.
--
-- Теперь ожидание — данные, а не подпись. Числа не захардкожены: то,
-- что инспектор должен увидеть, снимается ДО входа под ним, из тех же
-- таблиц под владельцем. Тогда тест не приходится править каждый раз,
-- когда в фикстуры 01–04 добавили ещё один расходник.
-- ═══════════════════════════════════════════════════════════════════════════

\echo '--- ИНСПЕКТОР: подготовка — чужой арендатор с такими же данными'
-- Без чужого арендатора проверка изоляции — выдумка: представление,
-- которое просто отдаёт всё, что видит владелец, прошло бы её.
-- «Магазин 2» заведён в 02_stock; здесь ему дописывается компланс-состав.
insert into public.materials (id, tenant_id, name, unit, is_cosmetic, pao_months)
values ('dddddddd-0000-0000-0000-000000000093','aaaaaaaa-0000-0000-0000-000000000091',
        'Чужий засіб','мл', true, 6)
on conflict (id) do nothing;

insert into public.material_batches
  (id, tenant_id, material_id, batch_number, expiry_date, created_by)
values ('abcd0000-0000-0000-0000-000000000093','aaaaaaaa-0000-0000-0000-000000000091',
        'dddddddd-0000-0000-0000-000000000093','LOT-CHUZHE',
        current_date + 300, '11111111-1111-1111-1111-111111111111')
on conflict (id) do nothing;

insert into public.material_containers
  (id, tenant_id, material_id, batch_id, code, status, created_by)
values ('abcd0000-0000-0000-0000-000000000094','aaaaaaaa-0000-0000-0000-000000000091',
        'dddddddd-0000-0000-0000-000000000093','abcd0000-0000-0000-0000-000000000093',
        'CNT-CHUZHE','opened','11111111-1111-1111-1111-111111111111')
on conflict (id) do nothing;

insert into public.tech_cards (id, tenant_id, title, steps, approved_by)
values ('bcbc0000-0000-0000-0000-000000000093','aaaaaaaa-0000-0000-0000-000000000091',
        'Чужа техкарта','[]'::jsonb,'11111111-1111-1111-1111-111111111111')
on conflict (id) do nothing;

-- Техкарта своего арендатора привязывается к услуге: без привязки нечем
-- проверить, что название услуги доезжает до инспектора (ТЗ 3.4).
update public.tech_cards
   set offering_id = 'bbbbbbbb-0000-0000-0000-000000000001'
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and title = 'Підготовка канекалону';

-- Имя исполнителя журнала — обязательный реквизит: отчёт для проверки
-- прямо утверждает «у кожного запису зафіксовано час та виконавця».
update public.profiles set full_name = 'Олена Власник'
 where id = '11111111-1111-1111-1111-111111111111';

-- Неопубликованная позиция своего же арендатора: на ней видно, что
-- `catalog.read` инспектору действительно не вернули. Опубликованная
-- витрина видна и анониму, поэтому доказывает она только то, что
-- витрина работает.
insert into public.offerings (id, tenant_id, kind, status, slug, title, price)
values ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',
        'service','draft','chernetka','Послуга-чернетка', 500)
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('44444444-4444-4444-4444-444444444444','inspector@dpss.gov.ua');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444','inspector');

-- Ожидания снимаются под владельцем, из таблиц. `grant select` — потому
-- что дальше читать их будет роль authenticated.
create temp table инспектор_ожид as
select (select count(*) from public.materials
         where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001')            as засоби,
       (select count(*) from public.material_batches
         where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001')            as партії,
       (select count(*) from public.material_containers
         where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001')            as ємності,
       (select count(*) from public.offerings
         where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001')            as послуги,
       (select count(*) from public.tenant_members
         where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001')            as учасники,
       (select count(*) from public.tech_cards
         where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001')            as техкарти,
       (select count(*) from public.sanitation_solutions
         where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001')            as дезрозчини,
       (select count(*) from public.sterilization_cycles
         where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001')            as стерилізація;
grant select on инспектор_ожид to authenticated;

\set QUIET on
select test.login('44444444-4444-4444-4444-444444444444');
\set QUIET off
set role authenticated;

-- Проверка НАЛИЧИЯ объектов идёт первой и роняет прогон: без них
-- запросы ниже не разберутся вовсе, и падение выглядело бы опечаткой
-- в тесте, а не отсутствием проекции.
do $$ begin
  if to_regclass('public.compliance_offerings') is null then
    raise exception 'ПРОВАЛ: немає подання compliance_offerings — техкарта у інспектора без назви послуги';
  end if;
  if to_regclass('public.compliance_actors') is null then
    raise exception 'ПРОВАЛ: немає подання compliance_actors — журнали у інспектора без виконавця';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'compliance_containers'
                    and column_name = 'pao_months') then
    raise exception 'ПРОВАЛ: у compliance_containers немає pao_months — екран відкриття читає таблицю напряму';
  end if;
end $$;

\echo '--- инспектор: коммерция и склад закрыты НАСОВСЕМ (таблицами, не экраном)'
select таблиця, рядків,
       case when рядків = 0 then 'ok'
            else 'ПРОВАЛ: інспектор бачить ' || рядків || ' рядків у ' || таблиця end as підсумок
  from (values
    ('materials',         (select count(*) from public.materials)),
    ('material_batches',  (select count(*) from public.material_batches)),
    ('suppliers',         (select count(*) from public.suppliers)),
    ('stock_movements',   (select count(*) from public.stock_movements)),
    ('stock_low_view',    (select count(*) from public.stock_low_view)),
    ('stock_value_view',  (select count(*) from public.stock_value_view)),
    -- Каталог проверяется отдельно и не отсюда: опубликованная витрина
    -- видна АНОНИМУ, и требовать от инспектора нуля значило бы требовать
    -- меньше, чем видит прохожий с улицы. Считается разница, а не ноль.
    ('customers',         (select count(*) from public.customers)),
    ('orders',            (select count(*) from public.orders)),
    ('finance_records',   (select count(*) from public.finance_records)),
    ('bookings',          (select count(*) from public.bookings))
  ) as t(таблиця, рядків);

\echo '--- инспектор: каталога у него нет — только то, что и так на витрине'
do $$ declare n int; begin
  select count(*) into n from public.offerings where status <> 'active';
  if n > 0 then
    raise exception 'ПРОВАЛ: інспектор бачить % неопублікованих позицій каталогу', n;
  end if;
  raise notice 'ok — неопублікований каталог інспектору не видно';
  select count(*) into n from public.offerings where price is not null and status = 'active';
  raise notice 'ok — з каталогу видно лише вітрину (% позицій), як і анонімові', n;
end $$;

-- Узость проекции — тоже предмет проверки, а не намерение автора:
-- лишняя колонка в compliance_offerings вернёт инспектору ровно то,
-- ради отзыва чего в 0035 забирали catalog.read.
do $$ declare cols text; begin
  select string_agg(column_name, ',' order by column_name) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'compliance_offerings';
  if cols is distinct from 'id,tenant_id,title' then
    raise exception 'ПРОВАЛ: compliance_offerings віддає колонки «%», а має лише id,tenant_id,title', cols;
  end if;
  raise notice 'ok — compliance_offerings вузьке: %', cols;
end $$;

\echo '--- инспектор: журналы и документы — прямо из таблиц, по compliance.read'
select що, факт, треба,
       case when факт = треба then 'ok'
            else 'ПРОВАЛ: ' || що || ' = ' || факт || ', очікували ' || треба end as підсумок
  from (select 'material_containers' as що,
               (select count(*) from public.material_containers) as факт,
               (select ємності from инспектор_ожид) as треба
        union all
        select 'sanitation_solutions',
               (select count(*) from public.sanitation_solutions),
               (select дезрозчини from инспектор_ожид)
        union all
        select 'sterilization_cycles',
               (select count(*) from public.sterilization_cycles),
               (select стерилізація from инспектор_ожид)
        union all
        select 'tech_cards',
               (select count(*) from public.tech_cards),
               (select техкарти from инспектор_ожид)) s;

\echo '--- инспектор: реестр и партии — только через компланс-представления'
select що, факт, треба,
       case when факт = треба then 'ok'
            else 'ПРОВАЛ: ' || що || ' = ' || факт || ', очікували ' || треба end as підсумок
  from (select 'compliance_materials' as що,
               (select count(*) from public.compliance_materials) as факт,
               (select засоби from инспектор_ожид) as треба
        union all
        select 'compliance_batches',
               (select count(*) from public.compliance_batches),
               (select партії from инспектор_ожид)
        union all
        select 'compliance_containers',
               (select count(*) from public.compliance_containers),
               (select ємності from инспектор_ожид)
        -- Проекция названий услуг: `catalog.read` забрали в 0035, а 0015
        -- выдавал его РАДИ названий услуг в техкартах. Без проекции
        -- техкарта у инспектора без названия услуги.
        union all
        select 'compliance_offerings',
               (select count(*) from public.compliance_offerings),
               (select послуги from инспектор_ожид)
        -- Имена исполнителей журналов: `profiles` читается только про себя
        -- (0001), поэтому вложенный join в отчёте отдавал null ВСЕМ ролям.
        union all
        select 'compliance_actors',
               (select count(*) from public.compliance_actors),
               (select учасники from инспектор_ожид)) s;

\echo '--- инспектор: у представлений заполнены поля, ради которых они заведены'
do $$
declare v record;
begin
  select material_name, batch_number into v
    from public.compliance_containers where code = 'CNT-001';
  if v.material_name is null then
    raise exception 'ПРОВАЛ: compliance_containers.material_name порожнє — вкладений join до закритої materials віддає null, а не помилку';
  end if;
  raise notice 'ok — ємність: засіб «%», партія «%»', v.material_name, v.batch_number;

  -- Дозатор CNT-001-A разлит со СВОИМ сроком (3 месяца) — на нём и видно,
  -- что представление отдаёт собственный PAO ёмкости, а не PAO засоба.
  -- Без этой колонки экран вскрытия и фасования не собирается и вынужден
  -- читать таблицу напрямую, то есть представление не покрывает свой экран.
  select pao_months into v
    from public.compliance_containers where code = 'CNT-001-A';
  if v.pao_months is distinct from 3 then
    raise exception 'ПРОВАЛ: compliance_containers.pao_months = %, очікували 3', v.pao_months;
  end if;
  raise notice 'ok — власний PAO дозатора видно через подання: % міс', v.pao_months;
end $$;

do $$
declare v text;
begin
  select o.title into v
    from public.tech_cards c
    join public.compliance_offerings o on o.id = c.offering_id
   where c.title = 'Підготовка канекалону';
  if v is null then
    raise exception 'ПРОВАЛ: техкарта у інспектора без назви послуги';
  end if;
  raise notice 'ok — техкарта прив''язана до послуги «%»', v;
end $$;

do $$
declare v text;
begin
  select full_name into v from public.compliance_actors
   where user_id = '11111111-1111-1111-1111-111111111111';
  if v is null then
    raise exception 'ПРОВАЛ: виконавець журналу без імені — звіт для перевірки бреше';
  end if;
  raise notice 'ok — виконавець журналу: %', v;
end $$;

\echo '--- инспектор: представления НЕ отдают чужого арендатора'
select що, чужих,
       case when чужих = 0 then 'ok'
            else 'ПРОВАЛ: ' || що || ' віддає ' || чужих || ' рядків чужого закладу' end as підсумок
  from (values
    ('compliance_materials',     (select count(*) from public.compliance_materials
                                   where tenant_id <> 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('compliance_batches',       (select count(*) from public.compliance_batches
                                   where tenant_id <> 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('compliance_containers',    (select count(*) from public.compliance_containers
                                   where tenant_id <> 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('compliance_offerings',     (select count(*) from public.compliance_offerings
                                   where tenant_id <> 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('compliance_actors',        (select count(*) from public.compliance_actors
                                   where tenant_id <> 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('compliance_batch_history', (select count(*) from public.compliance_batch_history
                                   where tenant_id <> 'aaaaaaaa-0000-0000-0000-000000000001'))
  ) as t(що, чужих);

\echo '--- инспектор не может писать: ни в журнал, ни в реестр, ни через представление'
do $$ begin
  insert into public.sanitation_solutions
    (tenant_id, agent_name, concentration, volume, expires_at, prepared_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001','Х','1%',1,
          now() + interval '1 day','44444444-4444-4444-4444-444444444444');
  raise exception 'ПРОВАЛ: инспектор записал в журнал';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

-- Ёмкость запирается ДВАЖДЫ: сначала охранник ссылок (0046) — он не
-- находит расходника, потому что `materials` инспектору не видна, — и
-- только потом RLS. Записано отдельно, чтобы никто не решил, что здесь
-- проверяется RLS: сообщение приходит от охранника.
do $$ begin
  insert into public.material_containers
    (tenant_id, material_id, code, status, created_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001',
          'CNT-INSP','sealed','44444444-4444-4444-4444-444444444444');
  raise exception 'ПРОВАЛ: інспектор завів ємність';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

-- А здесь чистая RLS: у техкарты нет охранников на INSERT, и упасть
-- она обязана именно на `with check` политики (compliance.write).
do $$ begin
  insert into public.tech_cards (tenant_id, title, steps, approved_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001','Регламент від інспектора',
          '[]'::jsonb,'44444444-4444-4444-4444-444444444444');
  raise exception 'ПРОВАЛ: інспектор завів техкарту';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

-- RLS на UPDATE не бросает исключение: она просто не отдаёт строку.
-- Поэтому проверяется число затронутых строк, а не факт ошибки —
-- иначе тест был бы зелёным при полностью открытой таблице.
do $$ declare n int; begin
  update public.tech_cards set title = 'переписано інспектором';
  get diagnostics n = row_count;
  if n > 0 then raise exception 'ПРОВАЛ: інспектор змінив % техкарт', n; end if;
  raise notice 'ok — техкарти інспектору не піддалися (0 рядків)';
end $$;

-- Представления автообновляемы (0061): без явного revoke право ЧИТАТЬ
-- реестр давало бы право его ПРАВИТЬ, мимо RLS исходной таблицы.
do $$ begin
  update public.compliance_materials set name = 'переписано через подання';
  raise exception 'ПРОВАЛ: інспектор пише в реєстр через подання';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

do $$ begin
  update public.compliance_offerings set title = 'переписано через подання';
  raise exception 'ПРОВАЛ: інспектор пише в каталог через подання';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;
reset role;

\echo '--- компланс-представления не отдаются анониму'
set role anon;
do $$ begin
  perform count(*) from public.compliance_offerings;
  raise exception 'ПРОВАЛ: анонім читає compliance_offerings';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

do $$ begin
  perform count(*) from public.compliance_actors;
  raise exception 'ПРОВАЛ: анонім читає compliance_actors';
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
