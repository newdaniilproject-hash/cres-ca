-- ===========================================================================
-- 0097. Срок хранения контактов покупателя в заказах и записях: 1095 дней.
-- ===========================================================================
--
-- ЧТО БЫЛО. 0091 и 0092 закрыли срок хранения СЛУЖЕБНЫХ таблиц и прямым
-- текстом оставили за скобками данные заведения: «customers, orders,
-- bookings — данные заведения, а не наши. Срок по ним считается отдельно
-- (обезличивание вместо удаления)». Это «отдельно» и делается здесь.
--
-- ПОЧЕМУ ОБЕЗЛИЧИВАНИЕ, А НЕ УДАЛЕНИЕ. Заказ трёхлетней давности — это
-- первичный учёт: он держит выручку, он сходится с finance_records, он
-- отвечает на вопрос налоговой «откуда деньги». Удалить его нельзя.
-- А телефон покупателя в нём не нужен ни для одного из этих вопросов.
-- Поэтому строка остаётся целиком, а контакт из неё уходит.
--
-- ПОЧЕМУ 1095 ДНЕЙ. Три года — общий срок исковой давности по ЦК України
-- (ст. 257). Пока он не вышел, контакт покупателя может понадобиться для
-- разбирательства по самому заказу; после — не может уже ничем.
--
-- ЧТО ИМЕННО УХОДИТ.
--   orders:   contact_name → 'вилучено' (колонка NOT NULL с проверкой на
--             непустоту, поэтому именно метка, а не NULL), contact_phone,
--             contact_email, delivery_address, delivery_branch, comment,
--             tracking_number.
--   bookings: contact_name → 'вилучено', contact_phone, comment,
--             cancel_reason.
--
-- ЧТО ОСТАЁТСЯ И ПОЧЕМУ. Суммы, статусы, даты, состав заказа, номер,
-- currency, source, delivery_city и delivery_method, customer_id и
-- buyer_user_id. Ни одно из этого не отвечает на вопрос «кто этот человек
-- и как с ним связаться», а без них не сходится ни учёт, ни аналитика.
-- Город остаётся намеренно: он не идентифицирует покупателя, а без него
-- пропадает единственный срез «откуда заказывают».
-- tracking_number уходит, хотя выглядит служебным: по накладной Нової
-- Пошти получателя находят у перевозчика, то есть это тот же контакт,
-- только через посредника.
--
-- ПОЧЕМУ БЕЗ ОГЛЯДКИ НА СТАТУС. Обезличивается всё старше срока, включая
-- заказ, который так и висит «новий» три года. Такой заказ не живой,
-- а его контакт — такие же персональные данные, как и все остальные.
-- Ограничение по статусу оставило бы забытые строки навсегда.
--
-- ── Щель в четырёх триггерах, и почему она названа отдельно ────────────────
--
-- Обезличивание — это UPDATE, а на orders и bookings висят триггеры,
-- написанные для живой работы. Им сообщается, что идёт уборка по сроку,
-- тем же локальным флагом `app.retention_sweep`, что и в 0092: он ставится
-- через set_config(..., true), живёт внутри одной транзакции и наружу
-- не вытекает.
--
--   • bookings_notify — ЕДИНСТВЕННЫЙ, кто мешает по-настоящему. Он AFTER
--     INSERT OR UPDATE без списка колонок, то есть срабатывает на каждую
--     обезличенную запись, лезет в staff, customers и profiles и трогает
--     очередь уведомлений. На тысяче строк это тысяча лишних обращений
--     ради письма, которое никому не уйдёт.
--   • audit_row — на orders и bookings его СЕГОДНЯ НЕТ (проверено:
--     он висит на двадцати других таблицах). Но он есть на `invitations`,
--     которые 0091 удаляет по сроку, — и на каждом удалении он копирует
--     удаляемую строку целиком в audit_log, вместе с почтой и хэшем
--     токена. То есть уборка по сроку СЕЙЧАС переписывает персональные
--     данные из одной таблицы в другую вместо того, чтобы их убрать.
--     Это не запас на будущее, это действующий дефект 0091.
--   • orders_guard и bookings_guard сегодня не мешают: они стерегут суммы
--     и переходы статусов, а уборка ни того, ни другого не касается.
--     Щель им дана по требованию задания и ради того, чтобы следующее
--     правило уборки не упёрлось в них молча. Цена этого решения названа
--     прямо: пока щель открыта, проверка матрицы переходов внутри уборки
--     не работает. Ограничитель — не флаг, а то, что обезличивание
--     ПЕРЕЧИСЛЯЕТ колонки поимённо и статуса среди них нет.
-- ===========================================================================

-- ── 1. Триггеры узнают про уборку ──────────────────────────────────────────
--
-- Тела перенесены целиком и без правок, кроме добавленной первой проверки:
-- эти функции применены на бою, и «заодно улучшить» их здесь нельзя.

create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  j_old    jsonb;
  j_new    jsonb;
  rec      jsonb;
  v_diff   jsonb := '{}'::jsonb;
  k        text;
  v_actor  uuid := auth.uid();
  v_tenant uuid;
begin
  -- Уборка по сроку (0091). Записывать в журнал действий то, что она
  -- удаляет, — значит переносить персональные данные, а не убирать их.
  -- Сам факт уборки не теряется: её итог пишется в security_events.
  if coalesce(current_setting('app.retention_sweep', true), 'off') = 'on' then
    return null;
  end if;

  j_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  j_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  rec   := coalesce(j_new, j_old);

  -- У таблицы tenants арендатор — она сама, поэтому id идёт вторым шансом.
  v_tenant := nullif(coalesce(rec ->> 'tenant_id', rec ->> 'id'), '')::uuid;
  if v_tenant is null then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(j_new) loop
      -- Кеши остатков ведёт журнал движений, updated_at и поисковый вектор
      -- меняются сами: в журнале действий это шум, который закрывает собой
      -- настоящие правки.
      if k in ('updated_at','search_tsv','current_stock','stock_qty',
               'reserved_qty','rating_avg','rating_count') then
        continue;
      end if;
      if (j_new -> k) is distinct from (j_old -> k) then
        v_diff := v_diff || jsonb_build_object(
          k, jsonb_build_object('was', j_old -> k, 'now', j_new -> k));
      end if;
    end loop;
    if v_diff = '{}'::jsonb then
      return null;
    end if;
  elsif tg_op = 'INSERT' then
    v_diff := jsonb_build_object('created', j_new);
  else
    v_diff := jsonb_build_object('deleted', j_old);
  end if;

  insert into public.audit_log
    (tenant_id, actor_id, actor_email, action, entity, entity_id, label, changes)
  values (
    v_tenant,
    v_actor,
    (select p.email from public.profiles p where p.id = v_actor),
    lower(tg_op),
    tg_table_name,
    -- У таблиц без собственного id (состав команды) ключом служит сотрудник.
    nullif(coalesce(rec ->> 'id', rec ->> 'user_id'), '')::uuid,
    coalesce(rec ->> 'name', rec ->> 'title', rec ->> 'code',
             rec ->> 'batch_number', rec ->> 'agent_name', rec ->> 'device'),
    v_diff
  );

  return null;
end;
$function$;

create or replace function public.orders_guard()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  -- Уборка по сроку правит только перечисленные поимённо контактные
  -- колонки; ни сумм, ни статуса она не касается — стеречь тут нечего.
  if coalesce(current_setting('app.retention_sweep', true), 'off') = 'on' then
    return new;
  end if;

  -- Производные суммы меняются только служебным путём.
  if coalesce(current_setting('vitrina.allow_order_write', true), '') <> 'on' then
    if new.subtotal is distinct from old.subtotal
       or new.total is distinct from old.total then
      raise exception 'subtotal/total пересчитываются от строк заказа — прямая правка запрещена';
    end if;
  end if;

  -- Переход статуса: только по матрице.
  if new.status is distinct from old.status then
    if not exists (
      select 1 from public.order_status_transitions t
       where t.from_status = old.status and t.to_status = new.status
    ) then
      raise exception 'переход % → % не разрешён', old.status, new.status;
    end if;

    -- Вехи проставляются сами, задним числом их не подделать.
    case new.status
      when 'confirmed' then new.confirmed_at := now();
      when 'paid'      then new.paid_at      := now();
      when 'shipped'   then new.shipped_at   := now();
      when 'completed' then new.completed_at := now();
      when 'cancelled' then new.cancelled_at := now();
      else null;
    end case;

    insert into public.order_events (order_id, tenant_id, from_status, to_status, actor)
    values (new.id, new.tenant_id, old.status, new.status, auth.uid());
  end if;

  return new;
end;
$function$;

create or replace function public.bookings_guard()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if coalesce(current_setting('app.retention_sweep', true), 'off') = 'on' then
    return new;
  end if;

  if new.status is distinct from old.status
     and not exists (
       select 1 from public.booking_status_transitions t
        where t.from_status = old.status and t.to_status = new.status
     ) then
    raise exception 'переход брони % → % не разрешён', old.status, new.status;
  end if;
  return new;
end;
$function$;

create or replace function public.bookings_notify()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_staff   text;
  v_email   extensions.citext;
  v_payload jsonb;
  v_start   timestamptz := lower(new.period);
begin
  -- Уборка по сроку. Ни письма, ни напоминания по записи трёхлетней
  -- давности не бывает; а обращение к staff, customers и profiles
  -- на каждую строку — это лишний проход по всей базе.
  if coalesce(current_setting('app.retention_sweep', true), 'off') = 'on' then
    return new;
  end if;

  select s.name into v_staff from public.staff s where s.id = new.staff_id;

  select c.email into v_email from public.customers c where c.id = new.customer_id;
  if v_email is null and new.buyer_user_id is not null then
    select p.email into v_email from public.profiles p where p.id = new.buyer_user_id;
  end if;

  v_payload := jsonb_build_object(
    'number',  new.number,
    'name',    coalesce(new.contact_name, ''),
    'title',   new.title || ' · ' || new.variant_name,
    'staff',   coalesce(v_staff, ''),
    'phone',   coalesce(new.contact_phone, ''),
    'when',    to_char(v_start, 'DD.MM HH24:MI'),
    'time',    to_char(v_start, 'HH24:MI'),
    'price',   new.price,
    'deposit', new.deposit_due,
    'reason',  coalesce(new.cancel_reason, ''));

  if tg_op = 'INSERT' then
    if v_email is not null then
      perform public.enqueue_notification(
        new.tenant_id, 'booking.created', 'email',
        format('booking:%s:created:email', new.id), v_payload, null,
        new.buyer_user_id, new.customer_id, new.contact_phone, v_email, 'booking', new.id);
    end if;

    if new.buyer_user_id is not null then
      perform public.enqueue_notification(
        new.tenant_id, 'booking.created', 'push',
        format('booking:%s:created:push', new.id), v_payload, null,
        new.buyer_user_id, new.customer_id, new.contact_phone, null, 'booking', new.id);
    end if;

    perform public.enqueue_staff_alert(
      new.tenant_id, 'seller.booking_created',
      format('booking:%s:staff', new.id), v_payload,
      'orders.read', 'booking', new.id);

    if v_start - interval '24 hours' > now() then
      if v_email is not null then
        perform public.enqueue_notification(
          new.tenant_id, 'booking.reminder_24h', 'email',
          format('booking:%s:r24:email', new.id), v_payload, v_start - interval '24 hours',
          new.buyer_user_id, new.customer_id, new.contact_phone, v_email, 'booking', new.id);
      end if;
      if new.buyer_user_id is not null then
        perform public.enqueue_notification(
          new.tenant_id, 'booking.reminder_24h', 'push',
          format('booking:%s:r24:push', new.id), v_payload, v_start - interval '24 hours',
          new.buyer_user_id, new.customer_id, new.contact_phone, null, 'booking', new.id);
      end if;
    end if;

    if v_start - interval '2 hours' > now() then
      if new.buyer_user_id is not null then
        perform public.enqueue_notification(
          new.tenant_id, 'booking.reminder_2h', 'push',
          format('booking:%s:r2:push', new.id), v_payload, v_start - interval '2 hours',
          new.buyer_user_id, new.customer_id, new.contact_phone, null, 'booking', new.id);
      elsif v_email is not null then
        perform public.enqueue_notification(
          new.tenant_id, 'booking.reminder_2h', 'email',
          format('booking:%s:r2:email', new.id), v_payload, v_start - interval '2 hours',
          new.buyer_user_id, new.customer_id, new.contact_phone, v_email, 'booking', new.id);
      end if;
    end if;

    return new;
  end if;

  if new.status in ('cancelled','no_show') and old.status is distinct from new.status then
    update public.notification_outbox
       set status = 'cancelled'
     where ref_type = 'booking' and ref_id = new.id and status = 'pending';

    if new.status = 'cancelled' then
      if v_email is not null then
        perform public.enqueue_notification(
          new.tenant_id, 'booking.cancelled', 'email',
          format('booking:%s:cancelled:email', new.id), v_payload, null,
          new.buyer_user_id, new.customer_id, new.contact_phone, v_email, 'booking', new.id);
      end if;
      if new.buyer_user_id is not null then
        perform public.enqueue_notification(
          new.tenant_id, 'booking.cancelled', 'push',
          format('booking:%s:cancelled:push', new.id), v_payload, null,
          new.buyer_user_id, new.customer_id, new.contact_phone, null, 'booking', new.id);
      end if;
    end if;
    return new;
  end if;

  if lower(new.period) is distinct from lower(old.period) then
    update public.notification_outbox
       set send_after = v_start - interval '24 hours',
           payload = v_payload
     where ref_type = 'booking' and ref_id = new.id
       and dedupe_key like format('booking:%s:r24%%', new.id) and status = 'pending';

    update public.notification_outbox
       set send_after = v_start - interval '2 hours',
           payload = v_payload
     where ref_type = 'booking' and ref_id = new.id
       and dedupe_key like format('booking:%s:r2:%%', new.id) and status = 'pending';
  end if;

  return new;
end;
$function$;

-- ── 2. Само обезличивание ──────────────────────────────────────────────────
--
-- Отдельной функцией, а не строкой внутри retention_sweep: там правила —
-- это «удалить по условию», а здесь «переписать перечисленные колонки».
-- Свести их в один цикл значило бы получить универсальный UPDATE
-- по имени таблицы и тексту условия — то есть ровно ту функцию,
-- которой можно переписать что угодно где угодно.

create or replace function public.retention_anonymize_contacts(
  p_days  integer default 1095,
  p_batch integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_cut     timestamptz;
  v_done    integer;
  v_orders  integer := 0;
  v_book    integer := 0;
  v_pass    integer;
begin
  -- Пол в 365 дней — не украшение. Вызов с p_days = 0 обезличил бы
  -- сегодняшние заказы, то есть стёр бы контакт живого покупателя.
  if p_days is null or p_days < 365 then
    raise exception 'retention_anonymize_contacts: строк хранения % днів менший за річний', p_days;
  end if;

  v_cut := now() - make_interval(days => p_days);
  perform set_config('app.retention_sweep', 'on', true);

  v_pass := 0;
  loop
    v_pass := v_pass + 1;
    update public.orders o
       set contact_name    = 'вилучено',
           contact_phone   = null,
           contact_email   = null,
           delivery_address= null,
           delivery_branch = null,
           comment         = null,
           tracking_number = null
     where o.ctid in (
       select x.ctid from public.orders x
        where x.created_at < v_cut
          and (x.contact_name is distinct from 'вилучено'
               or x.contact_phone    is not null
               or x.contact_email    is not null
               or x.delivery_address is not null
               or x.delivery_branch  is not null
               or x.comment          is not null
               or x.tracking_number  is not null)
        limit p_batch);
    get diagnostics v_done = row_count;
    v_orders := v_orders + v_done;
    exit when v_done < p_batch or v_pass >= 20;
  end loop;

  v_pass := 0;
  loop
    v_pass := v_pass + 1;
    update public.bookings b
       set contact_name  = 'вилучено',
           contact_phone = null,
           comment       = null,
           cancel_reason = null
     where b.ctid in (
       select x.ctid from public.bookings x
        where x.created_at < v_cut
          and (x.contact_name is distinct from 'вилучено'
               or x.contact_phone is not null
               or x.comment       is not null
               or x.cancel_reason is not null)
        limit p_batch);
    get diagnostics v_done = row_count;
    v_book := v_book + v_done;
    exit when v_done < p_batch or v_pass >= 20;
  end loop;

  return jsonb_build_object('orders', v_orders, 'bookings', v_book, 'older_than_days', p_days);
end;
$fn$;

comment on function public.retention_anonymize_contacts(integer, integer) is
  'Контакты покупателя из заказов и записей старше срока. Строка остаётся целиком — уходит только то, чем человека находят. Срок по умолчанию 1095 дней, меньше года функция не принимает.';

-- ── 3. Уборка зовёт обезличивание ──────────────────────────────────────────
--
-- Тело 0092 перенесено без изменений, добавлен один шаг и одно поле
-- в отчёте. Отдельного расписания не заводится: задание уже ходит раз
-- в сутки в 04:30 UTC, а два задания на одну работу разъедутся.

create or replace function public.retention_sweep(p_batch integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_rule   record;
  v_sql    text;
  v_done   integer;
  v_total  integer;
  v_result jsonb := '{}'::jsonb;
  v_failed jsonb := '{}'::jsonb;
  v_anon   jsonb := '{}'::jsonb;
  v_pass   integer;
begin
  perform set_config('app.retention_sweep', 'on', true);

  for v_rule in
    select * from (values
      ('security_events',       'at < now() - interval ''90 days'''),
      ('notification_outbox',   'status in (''sent'',''failed'',''cancelled'') and created_at < now() - interval ''180 days'''),
      ('reminders',             'status in (''done'',''dismissed'') and created_at < now() - interval ''180 days'''),
      ('stock_reservations',    'status in (''released'',''expired'',''committed'') and created_at < now() - interval ''90 days'''),
      ('invitations',           'status in (''accepted'',''revoked'') and created_at < now() - interval ''90 days'''),
      ('import_jobs',           'status in (''done'',''failed'',''cancelled'') and created_at < now() - interval ''90 days'''),
      ('ai_jobs',               'status in (''done'',''failed'',''cancelled'') and created_at < now() - interval ''90 days'''),
      ('known_devices',         'last_seen < now() - interval ''365 days'''),
      ('integration_access_log','created_at < now() - interval ''365 days''')
    ) as r(tbl, cond)
  loop
    v_total := 0;
    v_pass  := 0;

    begin
      loop
        v_pass := v_pass + 1;

        v_sql := format(
          'delete from public.%I where ctid in (select ctid from public.%I where %s limit %s)',
          v_rule.tbl, v_rule.tbl, v_rule.cond, p_batch);

        execute v_sql;
        get diagnostics v_done = row_count;
        v_total := v_total + v_done;

        exit when v_done < p_batch or v_pass >= 20;
      end loop;
    exception when others then
      -- Правило упало — записываем причину и идём дальше. Тишина здесь
      -- означала бы, что срок хранения не работает и об этом никто не знает.
      v_failed := v_failed || jsonb_build_object(v_rule.tbl, sqlerrm);
    end;

    if v_total > 0 then
      v_result := v_result || jsonb_build_object(v_rule.tbl, v_total);
    end if;
  end loop;

  -- Заказы и записи не удаляются никогда: это первичный учёт. Из них
  -- уходит только контакт. Отказ здесь тоже не роняет проход.
  begin
    v_anon := public.retention_anonymize_contacts(1095, p_batch);
  exception when others then
    v_failed := v_failed || jsonb_build_object('anonymize_contacts', sqlerrm);
  end;

  insert into public.security_events (kind, detail)
  values ('retention.sweep',
          jsonb_build_object('removed', v_result,
                             'anonymized', v_anon,
                             'failed', v_failed,
                             'batch', p_batch,
                             'empty', (v_result = '{}'::jsonb)));

  return jsonb_build_object('removed', v_result, 'anonymized', v_anon, 'failed', v_failed);
end;
$fn$;

comment on function public.retention_sweep(integer) is
  'Срок хранения: служебные таблицы удаляются, заказы и записи обезличиваются. Правила данными, партиями, отказ одного правила не отменяет остальные. Санитарные журналы, аудит и первичный учёт не удаляются никогда — список и причины в шапке 0091.';

-- ── 4. Права. Правило 7 ────────────────────────────────────────────────────
--
-- Обезличивание зовёт расписание и только оно. Ни одному пользователю
-- эта функция не нужна: она переписывает чужие строки в обход прав.

revoke all on function public.retention_anonymize_contacts(integer, integer) from public;
revoke all on function public.retention_anonymize_contacts(integer, integer) from anon;
revoke all on function public.retention_anonymize_contacts(integer, integer) from authenticated;

revoke all on function public.retention_sweep(integer) from public;
revoke all on function public.retention_sweep(integer) from anon;
revoke all on function public.retention_sweep(integer) from authenticated;

revoke all on function public.audit_row() from public;
revoke all on function public.audit_row() from anon;
revoke all on function public.audit_row() from authenticated;
revoke all on function public.orders_guard() from public;
revoke all on function public.orders_guard() from anon;
revoke all on function public.orders_guard() from authenticated;
revoke all on function public.bookings_guard() from public;
revoke all on function public.bookings_guard() from anon;
revoke all on function public.bookings_guard() from authenticated;
revoke all on function public.bookings_notify() from public;
revoke all on function public.bookings_notify() from anon;
revoke all on function public.bookings_notify() from authenticated;
