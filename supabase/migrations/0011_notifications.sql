-- 0011_notifications.sql
-- Уведомления покупателю и напоминания о записи.
--
-- Устройство — очередь (outbox), а не отправка «прямо из триггера».
-- Причина простая и проверяемая: отправка письма или пуша — это сетевой
-- вызов наружу, а он может подвиснуть или упасть. Если делать его внутри
-- транзакции смены статуса заказа, то падение почтовика откатит смену
-- статуса — продавец не сможет отгрузить заказ из-за чужого сервиса.
-- Поэтому база только СТАВИТ В ОЧЕРЕДЬ (это дёшево и транзакционно),
-- а отправляет отдельный обработчик, который читает очередь.
--
-- Второе: у каждой строки очереди есть ключ идемпотентности. Повторный
-- запуск обработчика, ретрай, перезапуск задачи — не отправят второе
-- письмо. Это тот же приём, что у движений остатка (ADR 0006).
--
-- Третье: напоминания за 24 часа и за 2 часа ставятся В МОМЕНТ ЗАПИСИ
-- со временем отправки в будущем, а не ищутся ежечасным перебором всех
-- броней. Отмена или перенос — гасят или сдвигают уже стоящие строки.
-- Канал по умолчанию — push и Viber: SMS в Украине дорог, и платить
-- за него должен тот, кто решил его включить.

create type public.notification_channel as enum ('inapp', 'push', 'viber', 'email', 'sms');

create type public.notification_status as enum ('pending', 'sent', 'failed', 'cancelled');

-- Шаблоны. tenant_id null = шаблон платформы (используется, если продавец
-- свой не завёл). Тексты живут ЗДЕСЬ, а не в коде отправки — правило
-- из docs/DOMAIN.md: «событие описывается один раз».
create table public.notification_templates (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid references public.tenants(id) on delete cascade,

  event      text not null,
  channel    public.notification_channel not null,
  locale     text not null default 'uk' check (locale in ('uk','ru','en')),

  subject    text,
  body       text not null,
  is_active  boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index notification_templates_key_idx
  on public.notification_templates (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
                                    event, channel, locale);

create trigger notification_templates_touch
  before update on public.notification_templates
  for each row execute function public.touch_updated_at();

-- Шаблоны платформы. Плейсхолдеры подставляет обработчик из payload.
insert into public.notification_templates (tenant_id, event, channel, locale, subject, body) values
  (null, 'order.created',   'email', 'uk', 'Замовлення №{{number}} прийнято',
   'Вітаємо, {{name}}! Ваше замовлення №{{number}} на суму {{total}} {{currency}} прийнято. Ми повідомимо про зміну статусу.'),
  (null, 'order.confirmed', 'email', 'uk', 'Замовлення №{{number}} підтверджено',
   'Замовлення №{{number}} підтверджено продавцем і готується до відправлення.'),
  (null, 'order.shipped',   'email', 'uk', 'Замовлення №{{number}} відправлено',
   'Замовлення №{{number}} передано перевізнику. Номер накладної: {{tracking}}.'),
  (null, 'order.cancelled', 'email', 'uk', 'Замовлення №{{number}} скасовано',
   'Замовлення №{{number}} скасовано. {{reason}}'),
  (null, 'order.created',   'push',  'uk', null, 'Замовлення №{{number}} прийнято'),
  (null, 'order.shipped',   'push',  'uk', null, 'Замовлення №{{number}} відправлено. ТТН {{tracking}}'),
  (null, 'booking.created', 'push',  'uk', null,
   'Запис на {{title}} — {{when}}. Майстер: {{staff}}'),
  (null, 'booking.created', 'viber', 'uk', null,
   'Вітаємо, {{name}}! Ви записані: {{title}}, {{when}}, майстер {{staff}}. Скасувати або перенести: {{link}}'),
  (null, 'booking.reminder_24h', 'viber', 'uk', null,
   'Нагадуємо: завтра о {{time}} — {{title}}, майстер {{staff}}. Якщо плани змінилися, перенесіть: {{link}}'),
  (null, 'booking.reminder_2h',  'push',  'uk', null,
   'Через 2 години: {{title}}, майстер {{staff}}'),
  (null, 'booking.cancelled',    'viber', 'uk', null,
   'Запис {{title}} на {{when}} скасовано. {{reason}}');

-- ─────────────────────────────────────────────────────────────────────────────
-- Очередь отправки
-- ─────────────────────────────────────────────────────────────────────────────

create table public.notification_outbox (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  event       text not null,
  channel     public.notification_channel not null,
  locale      text not null default 'uk',

  -- Кому. Пользователь платформы, если есть; иначе просто контакт.
  user_id     uuid references public.profiles(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  to_phone    text,
  to_email    citext,

  -- Данные для подстановки в шаблон.
  payload     jsonb not null default '{}'::jsonb,

  -- Когда отправлять. now() = как можно скорее; будущее = напоминание.
  send_after  timestamptz not null default now(),

  status      public.notification_status not null default 'pending',
  attempts    int not null default 0,
  last_error  text,
  sent_at     timestamptz,

  -- Повторный запуск обработчика не создаёт вторую отправку.
  dedupe_key  text not null,

  -- Что породило: заказ или бронь. Нужно, чтобы гасить напоминания
  -- при отмене и сдвигать при переносе.
  ref_type    text,
  ref_id      uuid,

  created_at  timestamptz not null default now(),

  unique (tenant_id, dedupe_key)
);

-- Индекс обработчика: он спрашивает «что пора отправить».
create index notification_outbox_due_idx
  on public.notification_outbox (send_after)
  where status = 'pending';

create index notification_outbox_tenant_idx on public.notification_outbox (tenant_id, created_at desc);
create index notification_outbox_ref_idx    on public.notification_outbox (ref_type, ref_id)
  where ref_id is not null;
create index notification_outbox_user_idx   on public.notification_outbox (user_id) where user_id is not null;
create index notification_outbox_customer_idx on public.notification_outbox (customer_id) where customer_id is not null;

-- Постановка в очередь. Внутренняя: вызывается только триггерами
-- и definer-функциями, наружу не выставляется.
create or replace function public.enqueue_notification(
  p_tenant_id   uuid,
  p_event       text,
  p_channel     public.notification_channel,
  p_dedupe_key  text,
  p_payload     jsonb default '{}'::jsonb,
  p_send_after  timestamptz default null,
  p_user_id     uuid default null,
  p_customer_id uuid default null,
  p_to_phone    text default null,
  p_to_email    citext default null,
  p_ref_type    text default null,
  p_ref_id      uuid default null,
  p_locale      text default 'uk'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  insert into public.notification_outbox
    (tenant_id, event, channel, locale, user_id, customer_id, to_phone, to_email,
     payload, send_after, dedupe_key, ref_type, ref_id)
  values
    (p_tenant_id, p_event, p_channel, p_locale, p_user_id, p_customer_id, p_to_phone, p_to_email,
     p_payload, coalesce(p_send_after, now()), p_dedupe_key, p_ref_type, p_ref_id)
  on conflict (tenant_id, dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.enqueue_notification(uuid, text, public.notification_channel, text, jsonb, timestamptz, uuid, uuid, text, citext, text, uuid, text)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Заказ: уведомления при смене статуса
-- ─────────────────────────────────────────────────────────────────────────────

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
    'name',     new.contact_name,
    'total',    new.total,
    'currency', new.currency,
    'tracking', coalesce(new.tracking_number, ''),
    'reason',   coalesce(new.cancel_reason, ''),
    'status',   new.status
  );

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

  return new;
end;
$$;

create trigger orders_notify
  after insert or update of status on public.orders
  for each row execute function public.orders_notify();

revoke execute on function public.orders_notify() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Запись: подтверждение и напоминания за 24 ч и 2 ч
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.bookings_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff   text;
  v_payload jsonb;
  v_start   timestamptz := lower(new.period);
begin
  select s.name into v_staff from public.staff s where s.id = new.staff_id;

  v_payload := jsonb_build_object(
    'number', new.number,
    'name',   new.contact_name,
    'title',  new.title || ' · ' || new.variant_name,
    'staff',  coalesce(v_staff, ''),
    'when',   to_char(v_start, 'DD.MM HH24:MI'),
    'time',   to_char(v_start, 'HH24:MI'),
    'price',  new.price,
    'deposit', new.deposit_due,
    'reason', coalesce(new.cancel_reason, ''),
    'link',   ''  -- ссылку на перенос подставляет обработчик: он знает домен
  );

  if tg_op = 'INSERT' then
    perform public.enqueue_notification(
      new.tenant_id, 'booking.created', 'viber',
      format('booking:%s:created', new.id), v_payload, null,
      new.buyer_user_id, new.customer_id, new.contact_phone, null, 'booking', new.id);

    -- Напоминания ставятся сразу, со временем отправки в будущем.
    -- Ставим только те, что ещё не наступили: запись «на через час»
    -- не должна породить напоминание за сутки в прошлом.
    if v_start - interval '24 hours' > now() then
      perform public.enqueue_notification(
        new.tenant_id, 'booking.reminder_24h', 'viber',
        format('booking:%s:r24', new.id), v_payload, v_start - interval '24 hours',
        new.buyer_user_id, new.customer_id, new.contact_phone, null, 'booking', new.id);
    end if;

    if v_start - interval '2 hours' > now() then
      perform public.enqueue_notification(
        new.tenant_id, 'booking.reminder_2h', 'push',
        format('booking:%s:r2', new.id), v_payload, v_start - interval '2 hours',
        new.buyer_user_id, new.customer_id, new.contact_phone, null, 'booking', new.id);
    end if;

    return new;
  end if;

  -- Отмена или неявка: гасим ещё не отправленные напоминания.
  if new.status in ('cancelled','no_show') and old.status is distinct from new.status then
    update public.notification_outbox
       set status = 'cancelled'
     where ref_type = 'booking' and ref_id = new.id and status = 'pending';

    if new.status = 'cancelled' then
      perform public.enqueue_notification(
        new.tenant_id, 'booking.cancelled', 'viber',
        format('booking:%s:cancelled', new.id), v_payload, null,
        new.buyer_user_id, new.customer_id, new.contact_phone, null, 'booking', new.id);
    end if;
    return new;
  end if;

  -- Перенос: двигаем время отправки напоминаний вслед за визитом.
  if lower(new.period) is distinct from lower(old.period) then
    update public.notification_outbox
       set send_after = v_start - interval '24 hours',
           payload = v_payload
     where ref_type = 'booking' and ref_id = new.id
       and dedupe_key = format('booking:%s:r24', new.id) and status = 'pending';

    update public.notification_outbox
       set send_after = v_start - interval '2 hours',
           payload = v_payload
     where ref_type = 'booking' and ref_id = new.id
       and dedupe_key = format('booking:%s:r2', new.id) and status = 'pending';
  end if;

  return new;
end;
$$;

create trigger bookings_notify
  after insert or update on public.bookings
  for each row execute function public.bookings_notify();

revoke execute on function public.bookings_notify() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Интерфейс обработчика
-- ─────────────────────────────────────────────────────────────────────────────
-- Обработчик работает сервисным ключом в фоне — это разрешённое место
-- для service_role (CLAUDE.md, правило 3: «только в фоновых задачах»).
-- Берёт пачку с блокировкой, чтобы два параллельных запуска не взяли
-- одну и ту же строку.

create or replace function public.notifications_take(p_limit int default 50)
returns setof public.notification_outbox
language sql
volatile
set search_path = ''
as $$
  update public.notification_outbox o
     set attempts = o.attempts + 1
   where o.id in (
     select id from public.notification_outbox
      where status = 'pending' and send_after <= now()
      order by send_after
      limit greatest(p_limit, 1)
      for update skip locked
   )
  returning o.*;
$$;

create or replace function public.notification_mark(
  p_id uuid, p_ok boolean, p_error text default null
)
returns void
language sql
volatile
set search_path = ''
as $$
  update public.notification_outbox
     set status = case when p_ok then 'sent'::public.notification_status
                       when attempts >= 5 then 'failed'::public.notification_status
                       else 'pending'::public.notification_status end,
         sent_at = case when p_ok then now() else sent_at end,
         send_after = case when p_ok then send_after
                           else now() + make_interval(mins => least(attempts * 5, 60)) end,
         last_error = p_error
   where id = p_id;
$$;

revoke execute on function public.notifications_take(int)                from public, anon, authenticated;
revoke execute on function public.notification_mark(uuid, boolean, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.notification_templates enable row level security;
alter table public.notification_outbox    enable row level security;

create policy notification_templates_read on public.notification_templates
  for select to authenticated
  using (tenant_id is null or tenant_id in (select public.tenants_with('settings.read')));

create policy notification_templates_insert on public.notification_templates
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('settings.write')));

create policy notification_templates_update on public.notification_templates
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('settings.write')))
  with check (tenant_id in (select public.tenants_with('settings.write')));

create policy notification_templates_delete on public.notification_templates
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('settings.write')));

-- Очередь видна продавцу (что уходило клиенту) и получателю.
-- Писать в неё напрямую нельзя никому: только enqueue_notification.
create policy notification_outbox_read on public.notification_outbox
  for select to authenticated
  using (
    tenant_id in (select public.tenants_with('customers.read'))
    or user_id = (select auth.uid())
  );
