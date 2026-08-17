-- ===========================================================================
-- 0089. Шаг 7, пункт А: персональные данные не попадают в журналы.
-- ===========================================================================
--
-- ЧТО БЫЛО. Правило приёмки 14 запрещает персональным данным попадать в журнал
-- ошибок. Проверено запросом на бою: у нас три места, где они туда попадают
-- сами, без чьего-либо умысла.
--
--   1. security_events.detail jsonb (0085) наполняет серверный роут тем, что
--      принёс запрос. В событии «перебор пароля» это тело формы входа,
--      то есть почта И ПАРОЛЬ. В событии «новое устройство» — что положат.
--      Журнал безопасности неизменяем: строку с паролем оттуда уже не убрать.
--   2. notification_outbox.last_error хранит ответ почтовика и пуш-провайдера
--      как есть. Resend возвращает адрес получателя в тексте ошибки,
--      OneSignal — идентификаторы. Это персональные данные покупателя,
--      лежащие в служебной таблице без срока хранения.
--   3. Сообщения самого Postgres при нарушении уникальности печатают значение:
--      «duplicate key value ... (tenant_id, phone)=(..., +380671234567)».
--      Такой текст уходит в ответ клиенту и в любой сборщик ошибок.
--
-- ЧТО СТАЛО. Один набор функций обезличивания в одном месте — правило проекта
-- «функция строится как модуль». Обезличивание навешено триггерами ДО записи,
-- а не оставлено на дисциплину вызывающего: вызывающих много, дисциплины
-- на всех не хватает, и именно так дефект и появился.
--
-- ПОЧЕМУ МАСКИРУЕМ, А НЕ ВЫРЕЗАЕМ. Из «+38*******67» видно, что телефон был
-- и какой у него хвост — этого хватает, чтобы сопоставить с обращением
-- клиента и найти причину сбоя. Из «***» не видно ничего, и разбирать
-- инцидент становится нечем. Исключение — пароли и токены: они вырезаются
-- целиком, их хвост не нужен никому.
--
-- ЧЕГО ЭТА МИГРАЦИЯ НЕ ДЕЛАЕТ. Она не трогает таблицы, где контакты лежат
-- по делу: customers, orders.contact_phone, bookings.contact_phone,
-- notification_outbox.to_phone и to_email. Там данные нужны для работы,
-- и закрывает их не обезличивание, а права (0078) и срок хранения (0091).
-- ===========================================================================

-- ── 1. Маскировщики. Immutable: применяются в том числе в выражениях ─────────

create or replace function public.mask_phone(p_value text)
returns text language sql immutable set search_path to '' as $fn$
  select case
    when p_value is null then null
    when length(btrim(p_value)) <= 4 then '***'
    else repeat('*', length(btrim(p_value)) - 2) || right(btrim(p_value), 2)
  end;
$fn$;

comment on function public.mask_phone(text) is
  'Телефон для журнала: остаются две последние цифры. Их хватает, чтобы сопоставить строку с обращением клиента, и не хватает, чтобы позвонить.';

create or replace function public.mask_email(p_value text)
returns text language sql immutable set search_path to '' as $fn$
  select case
    when p_value is null then null
    when position('@' in p_value) < 2 then '***'
    else left(p_value, 1) || '***@' || split_part(p_value, '@', 2)
  end;
$fn$;

comment on function public.mask_email(text) is
  'Почта для журнала: первая буква и домен. Домен остаётся намеренно — по нему видно, наш ли это почтовик отказал и какому провайдеру писать.';

create or replace function public.mask_name(p_value text)
returns text language sql immutable set search_path to '' as $fn$
  select case
    when p_value is null then null
    when length(btrim(p_value)) = 0 then p_value
    else left(btrim(p_value), 1) || '***'
  end;
$fn$;

comment on function public.mask_name(text) is
  'Имя и фамилия для журнала: инициал.';

-- ── 2. Свободный текст. Сообщения провайдеров и Postgres ────────────────────
--
-- Разбирать чужой текст регулярным выражением — заведомо неполно, поэтому
-- порядок такой: сначала более узкий образец (почта), потом более широкий
-- (последовательность цифр). Обратная последовательность съела бы цифры
-- внутри адреса и почта перестала бы распознаваться.

create or replace function public.mask_text_pii(p_value text)
returns text language sql immutable set search_path to '' as $fn$
  select case when p_value is null then null else
    regexp_replace(
      regexp_replace(
        p_value,
        '([[:alnum:]._%+-])[[:alnum:]._%+-]*@([[:alnum:].-]+\.[[:alpha:]]{2,})',
        '\1***@\2', 'g'),
      '\+?[0-9][0-9 ()\-]{7,}[0-9]',
      '<номер прихований>', 'g')
  end;
$fn$;

comment on function public.mask_text_pii(text) is
  'Обезличивание свободного текста: адреса почты и последовательности цифр длиной от девяти. Применяется к ответам почтовика и пуш-провайдера.';

-- ── 3. Обезличивание объекта целиком ────────────────────────────────────────
--
-- Ключи разобраны по СМЫСЛУ, а не по списку конкретных имён: роут может
-- положить и contact_phone, и to_phone, и просто phone. Список имён разошёлся
-- бы с кодом через неделю, образец — нет.

create or replace function public.redact_pii(p_value jsonb)
returns jsonb language plpgsql immutable set search_path to '' as $fn$
declare
  v_key   text;
  v_item  jsonb;
  v_out   jsonb := '{}'::jsonb;
begin
  if p_value is null then
    return null;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    return (select coalesce(jsonb_agg(public.redact_pii(e)), '[]'::jsonb)
              from jsonb_array_elements(p_value) e);
  end if;

  if jsonb_typeof(p_value) <> 'object' then
    return p_value;
  end if;

  for v_key, v_item in select key, value from jsonb_each(p_value) loop
    if lower(v_key) ~ '(password|passwd|pwd|secret|token|api_?key|authorization|otp|refresh)' then
      v_out := v_out || jsonb_build_object(v_key, to_jsonb('<вилучено>'::text));

    elsif jsonb_typeof(v_item) in ('object', 'array') then
      v_out := v_out || jsonb_build_object(v_key, public.redact_pii(v_item));

    elsif jsonb_typeof(v_item) <> 'string' then
      v_out := v_out || jsonb_build_object(v_key, v_item);

    elsif lower(v_key) ~ '(phone|tel$|_tel|mobile)' then
      v_out := v_out || jsonb_build_object(v_key, to_jsonb(public.mask_phone(v_item #>> '{}')));

    elsif lower(v_key) ~ '(e?mail)' then
      v_out := v_out || jsonb_build_object(v_key, to_jsonb(public.mask_email(v_item #>> '{}')));

    elsif lower(v_key) ~ '(first_name|last_name|surname|full_name|contact_name|customer_name|patronymic)' then
      v_out := v_out || jsonb_build_object(v_key, to_jsonb(public.mask_name(v_item #>> '{}')));

    elsif lower(v_key) ~ '(address|street|apartment|building|delivery_branch|delivery_address)' then
      v_out := v_out || jsonb_build_object(v_key, to_jsonb('<адреса прихована>'::text));

    else
      v_out := v_out || jsonb_build_object(v_key, to_jsonb(public.mask_text_pii(v_item #>> '{}')));
    end if;
  end loop;

  return v_out;
end;
$fn$;

comment on function public.redact_pii(jsonb) is
  'Рекурсивное обезличивание объекта перед записью в журнал. Ключи разбираются по образцу имени, а не по списку: список разошёлся бы с кодом.';

-- ── 4. Триггеры: обезличивание ДО записи, а не по договорённости ─────────────

create or replace function public.security_events_redact()
returns trigger language plpgsql set search_path to '' as $fn$
begin
  new.detail := coalesce(public.redact_pii(new.detail), '{}'::jsonb);
  new.user_agent := left(coalesce(new.user_agent, ''), 400);
  if new.user_agent = '' then
    new.user_agent := null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists security_events_redact_ins on public.security_events;
create trigger security_events_redact_ins
  before insert on public.security_events
  for each row execute function public.security_events_redact();

comment on function public.security_events_redact() is
  'Журнал безопасности неизменяем — значит обезличивать надо ДО вставки, потом строку уже не поправить.';

create or replace function public.notification_outbox_redact()
returns trigger language plpgsql set search_path to '' as $fn$
begin
  new.last_error := public.mask_text_pii(new.last_error);
  return new;
end;
$fn$;

drop trigger if exists notification_outbox_redact_err on public.notification_outbox;
create trigger notification_outbox_redact_err
  before insert or update of last_error on public.notification_outbox
  for each row execute function public.notification_outbox_redact();

comment on function public.notification_outbox_redact() is
  'Ответ почтовика и пуш-провайдера содержит адрес получателя. В служебной колонке ошибки он не нужен.';

-- ── 5. Права. Правило 7: каждая функция заканчивается revoke/grant ──────────

revoke all on function public.mask_phone(text) from public;
revoke all on function public.mask_email(text) from public;
revoke all on function public.mask_name(text) from public;
revoke all on function public.mask_text_pii(text) from public;
revoke all on function public.redact_pii(jsonb) from public;
revoke all on function public.security_events_redact() from public;
revoke all on function public.notification_outbox_redact() from public;

grant execute on function public.mask_phone(text) to authenticated;
grant execute on function public.mask_email(text) to authenticated;
grant execute on function public.mask_name(text) to authenticated;
grant execute on function public.mask_text_pii(text) to authenticated;
grant execute on function public.redact_pii(jsonb) to authenticated;
