-- 0023_notifications_delivery.sql
-- Восстановлено из боевой базы 11.08.2026 — файла не было в репозитории,
-- хотя миграция применена (version 20260805040108). См. КОНСПЕКТЫ.md
-- о необходимости сверки git с продом перед следующей миграцией.
--
-- Что делает: Viber и SMS не подключены (см. CLAUDE.md, «Уведомления») —
-- шаблоны этих каналов и уже поставленные в очередь письма отменяются,
-- чтобы не копить обречённые попытки отправки. Заводит стартовый набор
-- шаблонов на украинском для записей и заказов. Добавляет
-- enqueue_staff_alert() — рассылку сотрудникам с нужным правом
-- (например orders.read), и триггеры bookings_notify/orders_notify,
-- которые ставят в notification_outbox письма/пуши покупателю и
-- уведомление продавцу при создании и смене статуса.

delete from public.notification_templates where channel in ('viber', 'sms');

update public.notification_outbox
   set status = 'cancelled'
 where status = 'pending' and channel in ('viber', 'sms');

insert into public.notification_templates (tenant_id, event, channel, locale, subject, body, is_active)
values
  (null, 'booking.created', 'email', 'uk',
   'Запис підтверджено — {{when}}',
   'Вітаємо, {{name}}! Ви записані: {{title}}, {{when}}. Майстер: {{staff}}. ' ||
   'Якщо плани зміняться — попередьте заклад заздалегідь.', true),
  (null, 'booking.reminder_24h', 'email', 'uk',
   'Нагадування: завтра о {{time}}',
   '{{name}}, нагадуємо про запис: {{title}}, {{when}}. Майстер: {{staff}}.', true),
  (null, 'booking.reminder_24h', 'push', 'uk',
   null,
   'Завтра о {{time}} — {{title}}. Майстер: {{staff}}', true),
  (null, 'booking.reminder_2h', 'email', 'uk',
   'Нагадування: сьогодні о {{time}}',
   '{{name}}, ваш запис сьогодні о {{time}}: {{title}}. Майстер: {{staff}}.', true),
  (null, 'booking.cancelled', 'email', 'uk',
   'Запис скасовано — {{when}}',
   '{{name}}, ваш запис {{title}} на {{when}} скасовано. {{reason}}', true),
  (null, 'booking.cancelled', 'push', 'uk',
   null,
   'Запис {{when}} скасовано', true),
  (null, 'seller.order_created', 'email', 'uk',
   'Нове замовлення №{{number}} на {{total}} {{currency}}',
   'Нове замовлення №{{number}}. Клієнт: {{name}}, {{phone}}. ' ||
   'Сума: {{total}} {{currency}}. Відкрийте кабінет, щоб підтвердити.', true),
  (null, 'seller.booking_created', 'email', 'uk',
   'Новий запис №{{number}} — {{when}}',
   'Новий запис №{{number}}: {{title}}, {{when}}. ' ||
   'Клієнт: {{name}}, {{phone}}. Майстер: {{staff}}.', true);

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
    select tm.user_id, p.email::text as email, coalesce(p.locale, 'uk') as locale
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
  v_email   text;
  v_payload jsonb;
  v_start   timestamptz := lower(new.period);
begin
  select s.name into v_staff from public.staff s where s.id = new.staff_id;

  select c.email::text into v_email from public.customers c where c.id = new.customer_id;
  if v_email is null and new.buyer_user_id is not null then
    select p.email::text into v_email from public.profiles p where p.id = new.buyer_user_id;
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

create or replace function public.orders_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event   text;
  v_payload jsonb;
begin
  v_event := case new.status
    when 'confirmed' then 'order.confirmed'
    when 'shipped'   then 'order.shipped'
    when 'cancelled' then 'order.cancelled'
    when 'delivered' then 'order.delivered'
    else null end;

  if tg_op = 'INSERT' then
    v_event := 'order.created';
  elsif new.status is not distinct from old.status then
    return new;
  end if;

  if v_event is null then
    return new;
  end if;

  v_payload := jsonb_build_object(
    'number',   new.number,
    'name',     coalesce(new.contact_name, ''),
    'phone',    coalesce(new.contact_phone, ''),
    'total',    new.total,
    'currency', new.currency,
    'tracking', coalesce(new.tracking_number, ''),
    'reason',   coalesce(new.cancel_reason, ''),
    'status',   new.status);

  if new.contact_email is not null then
    perform public.enqueue_notification(
      new.tenant_id, v_event, 'email',
      format('order:%s:%s:email', new.id, v_event),
      v_payload, null, new.buyer_user_id, new.customer_id,
      new.contact_phone, new.contact_email, 'order', new.id);
  end if;

  if new.buyer_user_id is not null then
    perform public.enqueue_notification(
      new.tenant_id, v_event, 'push',
      format('order:%s:%s:push', new.id, v_event),
      v_payload, null, new.buyer_user_id, new.customer_id,
      new.contact_phone, new.contact_email, 'order', new.id);
  end if;

  if tg_op = 'INSERT' then
    perform public.enqueue_staff_alert(
      new.tenant_id, 'seller.order_created',
      format('order:%s:staff', new.id), v_payload,
      'orders.read', 'order', new.id);
  end if;

  return new;
end;
$$;

revoke execute on function public.orders_notify() from public;
revoke execute on function public.orders_notify() from anon, authenticated;
