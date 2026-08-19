-- 41. Гостевая история подтягивается в аккаунт по подтверждённой почте (0120).
--
-- Сценарий целиком, как на бою: гость заказывает и записывается с почтой,
-- ПОТОМ заводит аккаунт на ту же почту, подтверждает её — и всё его
-- становится его. И контрольный выстрел: по одному лишь ТЕЛЕФОНУ ничего
-- не привязывается, потому что телефон не подтверждён ничем.

\set ON_ERROR_STOP on
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off

\echo '=== 41. Привʼязка гостьової історії ==='

\echo '--- гость заказывает с почтой (аккаунта ещё нет)'
set role anon;
select o.number is not null as заказ_создан
  from public.create_order(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '[{"variant_id":"cccccccc-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
    'Гість Сорок Один', '+380671234541', 'guest41@test.ua'
  ) o;

\echo '--- и записывается на услугу с той же почтой'
select b.number is not null as запис_створено
  from public.create_booking(
    'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002',
    'eeeeeeee-0000-0000-0000-000000000001',
    (current_date + 25 + time '10:00') at time zone 'Europe/Kyiv',
    'Гість Сорок Один', '+380671234541',
    p_contact_email => 'guest41@test.ua') b;
reset role;

\echo '--- почта записи легла в bookings.contact_email'
do $$ declare e text; begin
  select contact_email into e from public.bookings
   where contact_name = 'Гість Сорок Один';
  if e = 'guest41@test.ua' then raise notice 'ок: пошта в записі';
  else raise exception 'ПРОВАЛ: contact_email=%', coalesce(e, '<null>'); end if;
end $$;

\echo '--- ГЛАВНОЕ: регистрация + подтверждение почты подтягивают всё'
do $$ declare v_o int; v_b int; v_c int; begin
  insert into auth.users (id, email)
  values ('41000000-0000-0000-0000-000000000001', 'guest41@test.ua');
  -- Подтверждение кода из письма: GoTrue ставит email_confirmed_at.
  update auth.users set email_confirmed_at = now()
   where id = '41000000-0000-0000-0000-000000000001';

  select count(*) into v_o from public.orders
   where buyer_user_id = '41000000-0000-0000-0000-000000000001';
  select count(*) into v_b from public.bookings
   where buyer_user_id = '41000000-0000-0000-0000-000000000001';
  select count(*) into v_c from public.customers
   where user_id = '41000000-0000-0000-0000-000000000001';

  if v_o >= 1 and v_b >= 1 and v_c >= 1 then
    raise notice 'ок: замовлень %, записів %, карток %', v_o, v_b, v_c;
  else
    raise exception 'ПРОВАЛ: замовлень %, записів %, карток %', v_o, v_b, v_c;
  end if;
end $$;

\echo '--- заказ без почты на ту же КАРТОЧКУ тоже привязался (путь через телефон карточки)'
do $$ declare v_o int; begin
  set local role anon;
  perform public.create_order(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '[{"variant_id":"cccccccc-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
    'Гість Сорок Один', '+380671234541');
  reset role;
  -- Досылка привязки: триггер уже отработал, но карточка теперь принадлежит
  -- человеку, и повторный вызов (например, при смене почты) доберёт хвост.
  perform public.claim_guest_history(
    '41000000-0000-0000-0000-000000000001', 'guest41@test.ua'::extensions.citext);
  select count(*) into v_o from public.orders
   where buyer_user_id = '41000000-0000-0000-0000-000000000001';
  if v_o >= 2 then raise notice 'ок: новий заказ через картку теж привʼязано';
  else raise exception 'ПРОВАЛ: замовлень %', v_o; end if;
end $$;

\echo '--- КОНТРОЛЬ: чужой номер без почты историю НЕ отдаёт'
do $$ declare v_o int; begin
  -- Гость с другим номером и другой почтой.
  set local role anon;
  perform public.create_order(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '[{"variant_id":"cccccccc-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
    'Інший Гість', '+380671234599', 'other41@test.ua');
  reset role;
  -- Человек регистрируется с ТРЕТЬЕЙ почтой: совпадений нет нигде.
  insert into auth.users (id, email)
  values ('41000000-0000-0000-0000-000000000002', 'nothing41@test.ua');
  update auth.users set email_confirmed_at = now()
   where id = '41000000-0000-0000-0000-000000000002';
  select count(*) into v_o from public.orders
   where buyer_user_id = '41000000-0000-0000-0000-000000000002';
  if v_o = 0 then raise notice 'ок: без збігу пошти нічого не привʼязано';
  else raise exception 'ПРОВАЛ: привʼязалося % чужих замовлень', v_o; end if;
end $$;

\echo '--- регистр почты не важен (citext)'
do $$ declare v_o int; begin
  insert into auth.users (id, email)
  values ('41000000-0000-0000-0000-000000000003', 'OTHER41@TEST.UA');
  update auth.users set email_confirmed_at = now()
   where id = '41000000-0000-0000-0000-000000000003';
  select count(*) into v_o from public.orders
   where buyer_user_id = '41000000-0000-0000-0000-000000000003';
  if v_o = 1 then raise notice 'ок: OTHER41 знайшов other41';
  else raise exception 'ПРОВАЛ: замовлень %', v_o; end if;
end $$;

\echo '--- уже привязанное не перепривязывается второму аккаунту'
do $$ declare v_o int; begin
  insert into auth.users (id, email)
  values ('41000000-0000-0000-0000-000000000004', 'guest41@test.ua');
  update auth.users set email_confirmed_at = now()
   where id = '41000000-0000-0000-0000-000000000004';
  select count(*) into v_o from public.orders
   where buyer_user_id = '41000000-0000-0000-0000-000000000004';
  if v_o = 0 then raise notice 'ок: історія лишилась у першого акаунта';
  else raise exception 'ПРОВАЛ: перепривʼязано %', v_o; end if;
end $$;

\echo '--- claim_guest_history закрыта от прямого вызова с клиента'
do $$ begin
  set local role authenticated;
  perform public.claim_guest_history(
    '41000000-0000-0000-0000-000000000002', 'guest41@test.ua'::extensions.citext);
  raise exception 'ПРОВАЛ: функцію привʼязки видно клієнту';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ок — %', sqlerrm;
end $$;

\echo '=== 41 пройдено ==='
