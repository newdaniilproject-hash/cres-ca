-- 0047. Предупреждение о сроке терялось навсегда.
--
-- ЧТО БЫЛО. containers_guard при смене use_by гасит прежние pending-строки
-- (status = 'cancelled') — правильно: дата в них уже неверна.
-- А enqueue_notification вставляет с
--   on conflict (tenant_id, dedupe_key) do nothing.
--
-- ПОЧЕМУ ЭТО ДЕФЕКТ. dedupe_key предупреждений уже содержит дату:
--   container:<id>:d14:<use_by>:<user>
-- То есть «положить use_by в ключ» — не лечение, это уже сделано.
-- Ломается другое: отменённая строка НЕ исчезает, она остаётся в таблице
-- и продолжает занимать уникальный ключ (tenant_id, dedupe_key). Стоит
-- вернуть прежний срок — ключ совпадает с уже занятым, do nothing молча
-- ничего не делает, и предупреждение не встаёт в очередь заново.
-- Навсегда: любая последующая попытка упрётся в ту же отменённую строку.
--
-- Замер до этой миграции на C-0006 (PAO туда-обратно 12 -> 3 -> 12):
--   PAO=12  pending/cancelled = 4/0
--   PAO=3   pending/cancelled = 0/4   (погасили — верно)
--   PAO=12  pending/cancelled = 0/4   (должно было стать 4/0)
--
-- ЧЕМ ГРОЗИЛО. Тихая потеря именно того уведомления, ради которого весь
-- модуль и написан: «косметика скоро протухнет». Ошибок нет, логов нет,
-- в интерфейсе всё выглядит нормально — просто письмо и пуш никогда не
-- придут. Достаточно один раз поправить PAO и вернуть обратно.
--
-- ЧТО СТАЛО. do nothing заменён на do update с условием
--   where notification_outbox.status = 'cancelled'
-- Отменённая строка воскресает: снова pending, с актуальными payload,
-- send_after, адресатом; счётчик попыток и последняя ошибка сбрасываются.
--
-- ПОЧЕМУ ИМЕННО ТАК, А НЕ ЧЕРЕЗ КЛЮЧ. Вариант «включить use_by в
-- dedupe_key» отпадает: он там уже есть (см. выше). Вариант «удалять
-- отменённые строки» ломает историю: outbox — это ещё и журнал того,
-- что было запланировано и снято.
--
-- ЗАЩИТА ОТ ДУБЛЕЙ НЕ ОСЛАБЛЕНА. Условие where пропускает только
-- cancelled. Строка в статусе pending остаётся нетронутой (повторное
-- сохранение ёмкости без смены срока не плодит и не сдвигает записи),
-- sent и failed тоже не трогаются — переотправкой ведает планировщик,
-- а не этот вызов. Проверено: три подряд UPDATE ёмкости без смены срока
-- оставляют ровно те же 4 pending и 5 строк всего.

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
  p_to_email    extensions.citext default null,
  p_ref_type    text default null,
  p_ref_id      uuid default null,
  p_locale      text default 'uk'
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $fn$
declare v_id uuid;
begin
  insert into public.notification_outbox
    (tenant_id, event, channel, locale, user_id, customer_id, to_phone, to_email,
     payload, send_after, dedupe_key, ref_type, ref_id)
  values
    (p_tenant_id, p_event, p_channel, p_locale, p_user_id, p_customer_id, p_to_phone, p_to_email,
     p_payload, coalesce(p_send_after, now()), p_dedupe_key, p_ref_type, p_ref_id)
  on conflict (tenant_id, dedupe_key) do update
     set status      = 'pending',
         event       = excluded.event,
         channel     = excluded.channel,
         locale      = excluded.locale,
         user_id     = excluded.user_id,
         customer_id = excluded.customer_id,
         to_phone    = excluded.to_phone,
         to_email    = excluded.to_email,
         payload     = excluded.payload,
         send_after  = excluded.send_after,
         ref_type    = excluded.ref_type,
         ref_id      = excluded.ref_id,
         attempts    = 0,
         last_error  = null,
         sent_at     = null
   where public.notification_outbox.status = 'cancelled'
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.enqueue_notification(
  uuid,text,public.notification_channel,text,jsonb,timestamptz,uuid,uuid,text,extensions.citext,text,uuid,text) from public;
grant execute on function public.enqueue_notification(
  uuid,text,public.notification_channel,text,jsonb,timestamptz,uuid,uuid,text,extensions.citext,text,uuid,text) to service_role;
