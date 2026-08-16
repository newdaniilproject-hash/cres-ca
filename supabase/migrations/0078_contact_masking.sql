-- ===========================================================================
-- 0078. Телефоны клиентов закрываются от тех, кому они не нужны
--       Шаг 4, пункт Б: «мастер видит телефоны только своих клиентов —
--       столбцовое ограничение, не только строчное»
-- ===========================================================================
--
-- ── ЧТО БЫЛО СЛОМАНО ─────────────────────────────────────────────────────
--
-- Найдено сверкой прав с политиками 16.08.2026. Роль `operator` — это
-- мастер — имеет право `orders.read`. Политика `bookings_read` отдаёт по
-- этому праву ВСЕ записи заведения целиком, вместе с `contact_phone`.
-- То же с заказами.
--
-- Значит любой мастер салона мог выгрузить телефоны ВСЕХ клиентов
-- заведения, включая тех, кого он никогда не обслуживал. Не ошибкой,
-- не обходом — штатным запросом к таблице, на которую ему выдано право.
--
-- Для салона это не абстракция: телефонная база клиентов — то, с чем
-- уходят к конкуренту. И это ровно тот случай, который в условиях сделки
-- назван «данные клиента — его собственность».
--
-- ── ПОЧЕМУ НЕ РЕШАЕТСЯ ПОЛИТИКОЙ ────────────────────────────────────────
--
-- RLS работает СТРОКАМИ. Здесь строки нужны все: мастер должен видеть
-- расписание заведения, чужие записи в том числе, иначе он не поймёт,
-- занят ли кабинет. Закрыть надо ОДНУ КОЛОНКУ в части строк — а такого
-- в RLS нет.
--
-- Права на колонку (`grant select (col)`) тоже не подходят: они выдаются
-- РОЛИ целиком, а нам нужно «этому мастеру в этих строках».
--
-- ── КАК СДЕЛАНО ─────────────────────────────────────────────────────────
--
-- 1. Право читать колонку `contact_phone` у роли `authenticated` отзывается
--    полностью — прямой путь к телефону закрыт для всех без исключения.
-- 2. Появляются представления `v_bookings` и `v_orders`: те же строки,
--    но телефон в них — ВЫЧИСЛЯЕМОЕ поле. Оно равно настоящему, если
--    у смотрящего есть право `customers.contacts`, либо это его
--    собственная запись, либо он сам покупатель. Иначе — NULL.
-- 3. Представления SECURITY DEFINER, и это осознанно: они обязаны читать
--    колонку, которую смотрящему читать нельзя. Значит изоляцию арендатора
--    они проверяют САМИ, в своём WHERE, повторяя условие политики. Тот же
--    приём уже применён к `compliance_*` (0014) и описан в
--    `scripts/check-grants.sh` списком `v_definer_ok` — туда добавлены
--    и эти два.
--
-- ⚠️ Отсюда следует правило, которое нельзя забыть: у DEFINER-представления
-- WHERE — это не удобство, а ЕДИНСТВЕННАЯ преграда. Уберут строку с
-- `tenants_with` — и представление начнёт отдавать чужие заведения всем.
-- Поэтому условие продублировано в тесте изоляции.
-- ===========================================================================

-- ── 1. Кто я как сотрудник ────────────────────────────────────────────────
--
-- Нужна для проверки «это моя запись». Читает `staff`, поэтому STABLE:
-- внутри одного запроса вызовется один раз, а не на каждую строку.
create or replace function public.my_staff_id(p_tenant_id uuid)
returns uuid language sql stable security definer set search_path to '' as $fn$
  select s.id from public.staff s
   where s.tenant_id = p_tenant_id and s.user_id = auth.uid()
   limit 1;
$fn$;

revoke all on function public.my_staff_id(uuid) from public, anon;
grant execute on function public.my_staff_id(uuid) to authenticated;

-- ── 2. Записи с телефоном по праву ────────────────────────────────────────

drop view if exists public.v_bookings;
create view public.v_bookings
with (security_barrier = true) as
select b.id, b.tenant_id, b.number, b.staff_id, b.offering_id, b.variant_id,
       b.customer_id, b.period, b.service_ends_at, b.status, b.title,
       b.variant_name, b.price, b.deposit_due, b.deposit_paid, b.currency,
       b.contact_name,
       case
         when public.tenant_can(b.tenant_id, 'customers.contacts') then b.contact_phone
         when b.staff_id is not null and b.staff_id = public.my_staff_id(b.tenant_id) then b.contact_phone
         when b.buyer_user_id = auth.uid() then b.contact_phone
         else null
       end as contact_phone,
       b.comment, b.cancel_reason, b.buyer_user_id, b.created_by,
       b.created_at, b.updated_at
  from public.bookings b
 where b.tenant_id in (select public.tenants_with('orders.read'))
    or b.buyer_user_id = auth.uid();

-- ── 3. Заказы с телефоном по праву ────────────────────────────────────────
--
-- У заказа нет мастера: заказ не «чей-то», он общий для заведения.
-- Поэтому правило проще — либо есть право на контакты, либо ты покупатель.
drop view if exists public.v_orders;
create view public.v_orders
with (security_barrier = true) as
select o.id, o.tenant_id, o.number, o.status, o.customer_id, o.buyer_user_id,
       o.contact_name,
       case
         when public.tenant_can(o.tenant_id, 'customers.contacts') then o.contact_phone
         when o.buyer_user_id = auth.uid() then o.contact_phone
         else null
       end as contact_phone,
       case
         when public.tenant_can(o.tenant_id, 'customers.contacts') then o.contact_email
         when o.buyer_user_id = auth.uid() then o.contact_email
         else null
       end as contact_email,
       o.delivery_method, o.delivery_city, o.delivery_branch, o.delivery_address,
       o.tracking_number, o.comment, o.cancel_reason,
       o.subtotal, o.discount, o.total, o.paid_amount, o.currency, o.source,
       o.created_by, o.created_at, o.updated_at,
       o.confirmed_at, o.paid_at, o.shipped_at, o.completed_at, o.cancelled_at
  from public.orders o
 where o.tenant_id in (select public.tenants_with('orders.read'))
    or o.buyer_user_id = auth.uid();

-- ── 4. Прямой путь к телефону закрывается ────────────────────────────────
--
-- Порядок важен: сначала представления, потом отзыв. Иначе между двумя
-- командами существует миг, когда телефон не читается ниоткуда.
--
-- ⚠️ ПОЧЕМУ НЕ `revoke select (contact_phone)`. Первая редакция делала
-- именно так — и НЕ РАБОТАЛА. Поймано тестом сразу же: колонка читалась
-- по-прежнему. Причина в устройстве прав Postgres: право на ТАБЛИЦУ
-- покрывает все её колонки, и отзыв права на одну колонку из него ничего
-- не вычитает. Отозвать колонку можно, только если права на таблицу нет,
-- а есть перечисленные права на колонки.
--
-- Поэтому: снимаем табличное SELECT и выдаём поимённо всё, кроме контактов.
--
-- Права выдаются и `anon` тоже, тем же списком. Не по недосмотру: без
-- всякого права аноним получал бы ОШИБКУ доступа там, где сейчас видит
-- честный пустой ответ от политики. Ошибка вместо нуля — это сообщение
-- «здесь что-то есть, но тебе нельзя», а пустой ответ не говорит ничего.
--
-- Цена решения названа прямо: НОВАЯ КОЛОНКА В ЭТИХ ДВУХ ТАБЛИЦАХ НЕ БУДЕТ
-- ЧИТАТЬСЯ, пока её не добавят в этот список. Это неудобно — и это лучше
-- обратного умолчания, при котором любая новая колонка автоматически
-- становится публичной для всех сотрудников.
revoke select on public.bookings from authenticated, anon;
grant select (
  id, tenant_id, number, staff_id, offering_id, variant_id, customer_id,
  period, service_ends_at, status, title, variant_name, price,
  deposit_due, deposit_paid, currency, contact_name, comment, cancel_reason,
  buyer_user_id, created_by, created_at, updated_at
) on public.bookings to anon, authenticated;

revoke select on public.orders from authenticated, anon;
grant select (
  id, tenant_id, number, status, customer_id, buyer_user_id, contact_name,
  delivery_method, delivery_city, delivery_branch, delivery_address,
  tracking_number, comment, cancel_reason, subtotal, discount, total,
  paid_amount, currency, source, created_by, created_at, updated_at,
  confirmed_at, paid_at, shipped_at, completed_at, cancelled_at
) on public.orders to anon, authenticated;

grant select on public.v_bookings to authenticated;
grant select on public.v_orders   to authenticated;
revoke all on public.v_bookings from anon;
revoke all on public.v_orders   from anon;

comment on view public.v_bookings is
  'Записи с телефоном, видимым по праву customers.contacts, своей записи или своей покупке. SECURITY DEFINER: изоляцию арендатора проверяет собственный WHERE.';
comment on view public.v_orders is
  'Заказы с контактами, видимыми по праву customers.contacts или своей покупке. SECURITY DEFINER: изоляцию арендатора проверяет собственный WHERE.';
