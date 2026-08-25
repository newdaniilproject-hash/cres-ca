-- 0125. Очередь уведомлений: очистить то, что уже просрочено.
--
-- ПОВОД. Отзыв владельца 25.08.2026 со снимком: колокол в шапке показывает
-- «99+», и снять это нечем. Счётчик считает строки `notification_outbox`
-- в статусе `pending` — то есть то, что ПОСТАВЛЕНО В ОЧЕРЕДЬ и ещё не ушло.
--
-- Почему их так много и почему это не дефект кода. Очередь разбирает
-- `/api/cron/notifications` сервисным ключом, и ему нужны `CRON_SECRET`
-- в переменных Vercel, Resend как SMTP и ключи OneSignal (CLAUDE.md →
-- «Что настраивается руками», п. 6). Пока эксплуатация не настроена,
-- триггеры честно ставят строки в очередь, а отправлять их некому —
-- они копятся. Это названо и в `notes/tz-conformance.md`.
--
-- ⚠️ ЧТО ЗДЕСЬ НЕЛЬЗЯ БЫЛО СДЕЛАТЬ, И ПОЧЕМУ.
--
-- 1. НЕЛЬЗЯ дать интерфейсу прямой UPDATE. У `notification_outbox` нет
--    и не было политики записи — в 0011 это сказано прямо: «Писать в неё
--    напрямую нельзя никому: только enqueue_notification». Добавить
--    политику UPDATE ради кнопки значило бы открыть очереди правку
--    из PostgREST целиком: статус, адресат, payload, время отправки.
--    Поэтому функция, и только она.
--
-- 2. НЕЛЬЗЯ гасить БУДУЩИЕ строки. В очереди лежат напоминания за 24 и 2
--    часа до записи — со временем отправки В БУДУЩЕМ. Кнопка «очистити»,
--    гасящая их заодно, тихо отменяет напоминание завтрашнему клиенту:
--    экран стал чище, человек не пришёл на процедуру. Поэтому функция
--    трогает только то, чей срок отправки УЖЕ ПРОШЁЛ, — то есть ровно
--    залежавшееся. Будущие напоминания остаются, и счётчик после очистки
--    честно показывает их число, а не ноль.
--
-- 3. НЕЛЬЗЯ удалять строки. Очередь — это ещё и журнал того, что было
--    запланировано и снято (та же причина названа в 0047). Ставим
--    `cancelled`, как это делают триггеры при отмене записи.
--
-- ЧТО ЭТО НЕ ЛОМАЕТ. Отменённая строка не мешает тому же событию встать
-- в очередь заново: `enqueue_notification` с 0047 ВОСКРЕШАЕТ cancelled
-- по тому же `dedupe_key`. То есть очистка — это не «потерять навсегда»,
-- а «убрать залежавшееся с глаз»; понадобится — вернётся само.
--
-- ПРАВО. `settings.write`, а не `customers.read`, которым очередь
-- ЧИТАЕТСЯ. Отмена отправки — это действие над тем, что уйдёт клиенту,
-- то есть настройка заведения, а не просмотр. Право читать список
-- не даёт права его гасить: иначе любой, кому открыты клиенты, мог бы
-- снять чужие напоминания.

create or replace function public.dismiss_notifications(
  p_tenant_id uuid,
  -- Пусто — «всё просроченное». Список — только эти строки, и всё равно
  -- только просроченные и только в этом заведении: идентификатор из
  -- адресной строки не имеет права расширять область действия.
  p_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer;
begin
  if not public.tenant_can(p_tenant_id, 'settings.write') then
    raise exception 'недостатньо прав';
  end if;

  update public.notification_outbox
     set status = 'cancelled'
   where tenant_id = p_tenant_id
     and status = 'pending'
     -- Только залежавшееся: будущие напоминания клиенту не трогаем.
     and send_after <= now()
     and (p_ids is null or id = any (p_ids));

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Postgres выдаёт EXECUTE роли PUBLIC на каждую новую функцию (правило 7).
revoke execute on function public.dismiss_notifications(uuid, uuid[]) from public;
revoke execute on function public.dismiss_notifications(uuid, uuid[]) from anon;
revoke execute on function public.dismiss_notifications(uuid, uuid[]) from authenticated;
grant  execute on function public.dismiss_notifications(uuid, uuid[]) to authenticated;
