-- 0028 — почему не создавался НИ ОДИН заказ и НИ ОДНА запись.
--
-- Найдено 14.08.2026 прогоном supabase/tests/run.sh, который до этого
-- дня не запускался: он падал на 0018 (pg_cron нет вне Supabase), то есть
-- обязательный шлюз «любая правка миграций прогоняется через run.sh
-- до коммита» не доходил ни до одного теста. Заглушки добавлены тем же
-- заходом, и первый же честный прогон уронил 03_orders.sql.
--
-- СУТЬ. enqueue_notification принимает p_to_email типа citext (0011).
-- В 0023 адрес приводили к text:
--     enqueue_staff_alert: select … p.email::text as email …
--     bookings_notify:     v_email text; select c.email::text into v_email;
-- Postgres при разборе ВЫЗОВА функции применяет только неявные приведения,
-- а text → citext объявлено в расширении как ASSIGNMENT, не как IMPLICIT.
-- Значит подходящей функции не находится вовсе:
--     ERROR: function public.enqueue_notification(…, text, …) does not exist
--
-- ЧТО ЭТО ЛОМАЛО. Обе функции зовутся из триггеров В ТОЙ ЖЕ ТРАНЗАКЦИИ,
-- что и вставка строки, поэтому падало не уведомление, а само действие:
--   • create_order → orders_notify → enqueue_staff_alert → отказ;
--   • любая запись на услугу → bookings_notify → отказ.
-- То есть оформить заказ и записаться на услугу было НЕЛЬЗЯ в принципе.
-- На проде на момент находки orders = 0 и bookings = 0 — дефект никем
-- не замечен ровно потому, что первый платящий клиент взял только склад,
-- а денежный путь после 0023 не проходил ни разу.
--
-- ПРАВИЛО НА БУДУЩЕЕ (в П-А КОНСПЕКТОВ). Под search_path = '' тип из
-- расширения пишется со схемой: extensions.citext. Приведение ::text
-- «чтобы не связываться со схемой» не обходит проблему, а переносит её
-- с объявления на вызов, где она уже не видна глазом.
--
-- Правка минимальная: адрес больше никуда не приводится, переменная
-- объявлена настоящим типом. Тела функций в остальном не тронуты —
-- взяты из 0023 дословно.

create or replace function public.enqueue_staff_alert(
  p_tenant     uuid,
  p_event      text,
  p_dedupe     text,
  p_payload    jsonb,
  p_permission text,
  p_ref_type   text,
  p_ref_id     uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in
    select tm.user_id, p.email as email, coalesce(p.locale, 'uk') as locale
      from public.tenant_members tm
      join public.profiles p on p.id = tm.user_id
     where tm.tenant_id = p_tenant
       and tm.role <> 'inspector'
       and p.email is not null
       and exists (
         select 1 from public.role_grants rg
          where rg.role = tm.role and rg.permission = p_permission)
  loop
    perform public.enqueue_notification(
      p_tenant, p_event, 'email',
      p_dedupe || ':' || r.user_id::text,
      p_payload, null,
      r.user_id, null, null, r.email, p_ref_type, p_ref_id, r.locale);
  end loop;
end;
$$;

revoke execute on function public.enqueue_staff_alert(uuid, text, text, jsonb, text, text, uuid) from public;
revoke execute on function public.enqueue_staff_alert(uuid, text, text, jsonb, text, text, uuid) from anon, authenticated;

create or replace function public.bookings_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff   text;
  v_email   extensions.citext;
  v_payload jsonb;
  v_start   timestamptz := lower(new.period);
begin
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
$$;

revoke execute on function public.bookings_notify() from public;
revoke execute on function public.bookings_notify() from anon, authenticated;
