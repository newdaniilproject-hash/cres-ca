-- 17_expiry_sku.sql — сроки годности и артикул (миграция 0022).
--
-- 0022 чинила механику, которая работала вхолостую: предупреждения о сроках
-- ставились каналом push с пустым получателем, обработчик на такой строке
-- падал, и за месяц работы салона ни одно предупреждение не дошло бы
-- никому — при том что контроль сроков это ровно то, за что салон платит.
--
-- 05_compliance уже проверяет одну ветку срока (PAO раньше партии) и запрет
-- на перенос даты вскрытия назад. Здесь — то, чего не проверял никто:
-- ВТОРАЯ ветка («меньшее из двух» в обратную сторону), получатели письма,
-- гашение устаревших предупреждений и уникальность артикула.

\set ON_ERROR_STOP on

\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off

\echo '--- 0022: срок вскрытой банки — МЕНЬШЕЕ из срока партии и «вскрытие + PAO»'
-- Материал с PAO 12 месяцев и партия, которая кончается через 30 дней.
-- Если бы считался только PAO, банку разрешили бы использовать год после
-- того, как истёк срок самого сырья.
set role authenticated;
insert into public.materials (id, tenant_id, name, unit, is_cosmetic, pao_months)
values ('aa170000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
        'Бальзам тестовий','флакон', true, 12);

insert into public.material_batches
  (id, tenant_id, material_id, batch_number, expiry_date, created_by)
values ('aa170000-0000-0000-0000-000000000011','aaaaaaaa-0000-0000-0000-000000000001',
        'aa170000-0000-0000-0000-000000000001','LOT-БЛИЗЬКА', current_date + 30,
        '11111111-1111-1111-1111-111111111111');

insert into public.material_containers
  (id, tenant_id, material_id, batch_id, code, status, created_by)
values ('aa170000-0000-0000-0000-000000000021','aaaaaaaa-0000-0000-0000-000000000001',
        'aa170000-0000-0000-0000-000000000001','aa170000-0000-0000-0000-000000000011',
        'CNT-БЛИЗЬКА','opened','11111111-1111-1111-1111-111111111111');
reset role;

select use_by                              as строк_ожид_партія,
       (use_by = current_date + 30)        as взято_партію_ожид_t,
       (use_by < (opened_at + interval '12 months')::date) as pao_відкинуто_ожид_t
  from public.material_containers where code = 'CNT-БЛИЗЬКА';

\echo '--- 0022: дату вскрытия нельзя не только сдвинуть, но и стереть'
-- 05 пробует перенести дату назад. Здесь — вторая половина того же
-- запрета: обнулить её, чтобы банка снова выглядела запечатанной.
set role authenticated;
do $$
begin
  update public.material_containers set opened_at = null where code = 'CNT-БЛИЗЬКА';
  raise exception 'ПРОВАЛ: дату відкриття стерли — банка знову «запечатана»';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

select opened_at is not null as дата_відкриття_на_місці_ожид_t
  from public.material_containers where code = 'CNT-БЛИЗЬКА';

\echo '--- 0022: предупреждение «за 14 днів» задним числом не досылается'
-- До конца срока 30 дней, значит четырнадцатидневный порог ещё впереди —
-- обе строки обязаны стоять в будущем. А вот у банки, заведённой позже
-- порога (ниже), «за 14» не будет вовсе.
select count(*) filter (where event = 'cosmetics.expiry_14d') as за_14_ожид_понад_0,
       count(*) filter (where event = 'cosmetics.expiry_7d')  as за_7_ожид_понад_0,
       bool_and(send_after > now())                           as все_у_майбутньому_ожид_t
  from public.notification_outbox
 where ref_type = 'container' and ref_id = 'aa170000-0000-0000-0000-000000000021';

\echo '--- 0022: письмо идёт тем, кто отвечает за склад, и НЕ инспектору'
-- Инспектор приходит на проверку, а не следит за банками (шапка 0022).
select count(*) filter (where user_id = '11111111-1111-1111-1111-111111111111') > 0
         as власнику_ожид_t,
       count(*) filter (where user_id = '22222222-2222-2222-2222-222222222222') > 0
         as оператору_ожид_t,
       count(*) filter (where user_id = '44444444-4444-4444-4444-444444444444')
         as інспектору_ожид_0,
       count(*) filter (where channel = 'email' and to_email is null)
         as листів_без_адреси_ожид_0
  from public.notification_outbox
 where ref_type = 'container' and ref_id = 'aa170000-0000-0000-0000-000000000021';

\echo '--- 0022: банка, заведённая позже порога, получает догоняющее «за 7»'
set role authenticated;
insert into public.material_batches
  (id, tenant_id, material_id, batch_number, expiry_date, created_by)
values ('aa170000-0000-0000-0000-000000000012','aaaaaaaa-0000-0000-0000-000000000001',
        'aa170000-0000-0000-0000-000000000001','LOT-ЗАВТРА', current_date + 3,
        '11111111-1111-1111-1111-111111111111');

insert into public.material_containers
  (id, tenant_id, material_id, batch_id, code, status, created_by)
values ('aa170000-0000-0000-0000-000000000022','aaaaaaaa-0000-0000-0000-000000000001',
        'aa170000-0000-0000-0000-000000000001','aa170000-0000-0000-0000-000000000012',
        'CNT-ЗАВТРА','opened','11111111-1111-1111-1111-111111111111');
reset role;

select count(*) filter (where event = 'cosmetics.expiry_14d') as за_14_ожид_0,
       count(*) filter (where event = 'cosmetics.expiry_7d') > 0 as за_7_ожид_t,
       bool_and(send_after <= now()) filter (where event = 'cosmetics.expiry_7d')
         as відправляється_одразу_ожид_t
  from public.notification_outbox
 where ref_type = 'container' and ref_id = 'aa170000-0000-0000-0000-000000000022';

\echo '--- 0022: списанная банка гасит свои неотправленные предупреждения'
set role authenticated;
update public.material_containers set status = 'disposed' where code = 'CNT-ЗАВТРА';
reset role;

select count(*) filter (where status = 'pending')   as живих_ожид_0,
       count(*) filter (where status = 'cancelled') > 0 as погашених_ожид_t
  from public.notification_outbox
 where ref_type = 'container' and ref_id = 'aa170000-0000-0000-0000-000000000022';

\echo '--- 0022: смена партии гасит предупреждения с прежней датой'
-- Срок поехал — старые письма про прежнюю дату больше не верны.
set role authenticated;
update public.material_containers
   set batch_id = 'aa170000-0000-0000-0000-000000000012'
 where code = 'CNT-БЛИЗЬКА';
reset role;

select (select use_by from public.material_containers where code = 'CNT-БЛИЗЬКА')
         = current_date + 3 as строк_перерахований_ожид_t,
       (select count(*) from public.notification_outbox
         where ref_type = 'container' and ref_id = 'aa170000-0000-0000-0000-000000000021'
           and status = 'cancelled') > 0 as старі_погашені_ожид_t;

-- ─────────────────────────────────────────────────────────────────────────
-- Артикул (ТЗ 3.1): уникален В МЕЖАХ ЗАКЛАДА и только среди заполненных
-- ─────────────────────────────────────────────────────────────────────────

\echo '--- 0022: артикул проставляется'
set role authenticated;
update public.materials set sku = 'JMB-100'
 where id = 'aa170000-0000-0000-0000-000000000001';
reset role;
select sku as артикул_ожид_jmb_100 from public.materials
 where id = 'aa170000-0000-0000-0000-000000000001';

\echo '--- 0022: два одинаковых артикула в одном закладе не уживаются'
set role authenticated;
do $$
begin
  insert into public.materials (tenant_id, name, unit, sku)
  values ('aaaaaaaa-0000-0000-0000-000000000001','Двійник','флакон','JMB-100');
  raise exception 'ПРОВАЛ: у закладі завелися два матеріали з одним артикулом';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0022: артикул без артикула — не артикул: пустые не мешают друг другу'
-- Частичный индекс `where sku is not null`. Если бы его не было,
-- второй расходник без артикула не завёлся бы вовсе.
insert into public.materials (tenant_id, name, unit)
values ('aaaaaaaa-0000-0000-0000-000000000001','Без артикулу А','шт'),
       ('aaaaaaaa-0000-0000-0000-000000000001','Без артикулу Б','шт');
select count(*) as без_артикула_ожид_2 from public.materials
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and name like 'Без артикулу%';
reset role;

\echo '--- 0022: тот же артикул в ДРУГОМ закладе — законен'
-- Уникальность пер-арендаторная (правило 1). Артикул производителя
-- одинаков у всех, кто этот товар возит; запрет на повтор в соседнем
-- закладе означал бы, что первый занял номер для всей платформы.
insert into public.materials (tenant_id, name, unit, sku)
values ('aaaaaaaa-0000-0000-0000-000000000091','Той самий бальзам','флакон','JMB-100');
select count(*) as матеріалів_з_jmb_100_ожид_2 from public.materials where sku = 'JMB-100';
