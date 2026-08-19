-- 39. Пуш продавцу и адрес скана (0117).
-- Продолжает данные 01/36: заведение aaaa…01, владелец 1111,
-- вариант 36…01 (штрихкода нет — заведём свой), оффер bbbb…01.

\set ON_ERROR_STOP on
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off

\echo '=== 39. Пуш продавцю; скан веде на картку ==='

\echo '--- ГЛАВНОЕ: заказ ставит продавцу И письмо, И пуш'
do $$ declare o public.orders; n_mail int; n_push int; begin
  select * into o from public.create_order(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '[{"variant_id":"36000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
    'Тест 39', '+380500000039');
  select count(*) into n_mail from public.notification_outbox
   where event = 'seller.order_created' and channel = 'email'
     and ref_id = o.id;
  select count(*) into n_push from public.notification_outbox
   where event = 'seller.order_created' and channel = 'push'
     and ref_id = o.id;
  if n_mail >= 1 and n_push >= 1
  then raise notice 'ок: листів %, пушів %', n_mail, n_push;
  else raise exception 'ПРОВАЛ: листів %, пушів %', n_mail, n_push; end if;
end $$;

\echo '--- пуш-шаблон продавца существует — иначе очередь уйдёт в failed'
select case when count(*) = 2 then 'ок'
            else 'ПРОВАЛ: шаблонів ' || count(*) end as проверка
  from public.notification_templates
 where event in ('seller.order_created', 'seller.booking_created')
   and channel = 'push' and tenant_id is null;

\echo '--- скан штрихкода варианта отдаёт offering_id для карточки'
do $$ declare hit record; begin
  update public.offering_variants set barcode = '4820000000039'
   where id = '36000000-0000-0000-0000-000000000001';
  select * into hit from public.scan_lookup(
    'aaaaaaaa-0000-0000-0000-000000000001', '4820000000039');
  if hit.kind = 'variant'
     and hit.offering_id = 'bbbbbbbb-0000-0000-0000-000000000001'
  then raise notice 'ок: варіант відомий, картка %', hit.offering_id;
  else raise exception 'ПРОВАЛ: kind %, offering %', hit.kind, hit.offering_id; end if;
end $$;

\echo '--- скан привязанного штрихкода засоба работает, offering_id пуст'
do $$ declare hit record; begin
  insert into public.material_barcodes (material_id, barcode, tenant_id)
  values ('dddddddd-0000-0000-0000-000000000001', '4820000000040',
          'aaaaaaaa-0000-0000-0000-000000000001');
  select * into hit from public.scan_lookup(
    'aaaaaaaa-0000-0000-0000-000000000001', '4820000000040');
  if hit.kind = 'material' and hit.offering_id is null
  then raise notice 'ок: засіб знайдено привʼязаним кодом';
  else raise exception 'ПРОВАЛ: kind %', hit.kind; end if;
end $$;
