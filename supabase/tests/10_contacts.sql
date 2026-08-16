-- 10_contacts.sql — телефоны клиентов (миграция 0078).
--
-- Дыра, ради которой это написано: у мастера есть `orders.read`, политика
-- записей отдаёт по нему ВСЕ записи заведения, и телефон каждого клиента
-- лежал в них открытым. Проверяется, что теперь мастер видит телефон
-- своей записи и НЕ видит чужой, а прямой путь к колонке закрыт всем.

\set ON_ERROR_STOP on

\echo '--- 0078: владелец видит телефон (есть customers.contacts)'
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
select contact_phone is not null as телефон_видно_ожид_t
  from public.v_bookings
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and contact_name = 'Марія Клієнт'
 limit 1;
reset role;

\echo '--- 0078: мастер НЕ видит телефон чужой записи'
-- У оператора нет customers.contacts, и запись не его: staff Оля
-- ни с одним пользователем не связана.
\set QUIET on
select test.login('22222222-2222-2222-2222-222222222222');
\set QUIET off
set role authenticated;
select contact_phone is null as чужий_телефон_прихований_ожид_t,
       contact_name = 'Марія Клієнт' as рядок_все_одно_видно_ожид_t
  from public.v_bookings
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and contact_name = 'Марія Клієнт'
 limit 1;

\echo '--- 0078: прямой путь к колонке закрыт даже владельцу токена'
do $$
begin
  perform contact_phone from public.bookings limit 1;
  raise exception 'ПРОВАЛ: колонка contact_phone читається напряму';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

\echo '--- 0078: своя запись — телефон виден'
-- Связываем мастера Олю с пользователем-оператором: теперь запись его.
update public.staff set user_id = '22222222-2222-2222-2222-222222222222'
 where id = 'eeeeeeee-0000-0000-0000-000000000001';

\set QUIET on
select test.login('22222222-2222-2222-2222-222222222222');
\set QUIET off
set role authenticated;
select contact_phone is not null as свій_телефон_видно_ожид_t
  from public.v_bookings
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and contact_name = 'Марія Клієнт'
 limit 1;
reset role;

-- Возвращаем как было: следующие тесты не должны зависеть от этой правки.
update public.staff set user_id = null
 where id = 'eeeeeeee-0000-0000-0000-000000000001';

\echo '--- 0078: представление не отдаёт чужое заведение'
-- Второе заведение и его владелец заведены в 06; если их нет,
-- проверка вырождается в ноль строк и это тоже верный ответ.
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
select count(*) as чужих_записів_ожид_0
  from public.v_bookings
 where tenant_id <> 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;

\echo '--- 0078: заказы — та же логика'
\set QUIET on
select test.login('22222222-2222-2222-2222-222222222222');
\set QUIET off
set role authenticated;
select count(*) filter (where contact_phone is not null) as телефонів_у_майстра_ожид_0
  from public.v_orders
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;
