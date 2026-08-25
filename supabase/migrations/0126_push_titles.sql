-- ── ЗАГОЛОВОК У ПУША: БЕЗ НЬОГО В ШТОРЦІ СТОЇТЬ ІМʼЯ ЗАСТОСУНКУ ──────────────
--
-- Знайдено 25.08.2026, коли OneSignal і Resend запрацювали і пуші пішли
-- на живий телефон. Власник попросив перевірити, «що приходить саме те,
-- що треба, і написано зрозуміло».
--
-- Механіка: `/api/cron/notifications` бере заголовок пуша з того самого
-- `subject`, що й лист (одна подія не має називатись по-різному в пошті
-- і в шторці). У ЧОТИРЬОХ push-шаблонів `subject` порожній — і тоді
-- `sendPush` не передає `headings` зовсім, а OneSignal підставляє імʼя
-- застосунку. Практичний підсумок: три різні сповіщення в шторці
-- виглядають однаково, і людина не знає, чи варто розблоковувати телефон.
-- Рівно про це попереджає коментар у `lib/notify/send.ts`, але у шаблонів
-- це не було виправлено.
--
-- ЧОМУ ЗАГОЛОВКИ САМЕ ТАКІ. Перший рядок відповідає на питання «що мені
-- з цим робити», а не вітається — правило тексту листів проекту. Тому
-- «Термін придатності» і «Нове замовлення», а не «Сповіщення» чи назва
-- закладу. Число днів у заголовок не виноситься: воно вже в тілі, і два
-- рядки, що починаються однаково, у шторці зливаються.
--
-- Підстановок у заголовках НЕМАЄ навмисно. `{{material}}` там виглядав би
-- краще рівно доти, доки назва засоба не виявиться довшою за ширину
-- шторки: система обрізає ЗАГОЛОВОК першим, і людина побачить
-- «Спрей-антизаплуту…», не дізнавшись, що це про термін. Назва стоїть
-- у тілі, де для неї є місце.
--
-- Міграція ДОДАЮЧА і безпечна в будь-якому порядку викату: вона лише
-- заповнює порожню колонку. До накату пуші приходять як раніше — без
-- заголовка; після — з ним.

-- Тільки платформні шаблони (`tenant_id is null`). Переозначення
-- орендаря не чіпаємо: якщо салон переписав текст під себе, заголовок —
-- теж його рішення, і мовчки міняти його не можна.
update public.notification_templates
   set subject = 'Термін придатності'
 where tenant_id is null
   and channel = 'push'
   and event in ('cosmetics.expiry_14d', 'cosmetics.expiry_7d')
   and subject is null;

update public.notification_templates
   set subject = 'Нове замовлення'
 where tenant_id is null
   and channel = 'push'
   and event = 'seller.order_created'
   and subject is null;

update public.notification_templates
   set subject = 'Новий запис'
 where tenant_id is null
   and channel = 'push'
   and event = 'seller.booking_created'
   and subject is null;

-- Ці два пуші йдуть КЛІЄНТОВІ, а не закладу, і заголовок у них важить
-- ще більше: у клієнта наш застосунок не відкритий, він бачить у шторці
-- рядок від незнайомого імені. «Нагадування про запис» пояснює його
-- за секунду, імʼя застосунку — ні.
update public.notification_templates
   set subject = 'Нагадування про запис'
 where tenant_id is null
   and channel = 'push'
   and event in ('booking.reminder_24h', 'booking.reminder_2h')
   and subject is null;

update public.notification_templates
   set subject = 'Запис скасовано'
 where tenant_id is null
   and channel = 'push'
   and event = 'booking.cancelled'
   and subject is null;

-- Ці чотири знайшов сам сторож нижче при першому накаті — рівно за цим
-- він і потрібен. Заголовки називають ПОДІЮ, а тіло вже несе номер
-- і подробиці: «Замовлення №1042 відправлено. ТТН …» у шторці читається
-- з першого слова, а не з номера.
update public.notification_templates
   set subject = 'Запис створено'
 where tenant_id is null and channel = 'push'
   and event = 'booking.created' and subject is null;

update public.notification_templates
   set subject = 'Замовлення прийнято'
 where tenant_id is null and channel = 'push'
   and event = 'order.created' and subject is null;

update public.notification_templates
   set subject = 'Замовлення відправлено'
 where tenant_id is null and channel = 'push'
   and event = 'order.shipped' and subject is null;

update public.notification_templates
   set subject = 'Замовлення доставлено'
 where tenant_id is null and channel = 'push'
   and event = 'order.delivered' and subject is null;

-- Сторож на майбутнє. Заголовок у пуша — не оздоблення: без нього
-- система підставляє імʼя застосунку, і різні сповіщення в шторці
-- виглядають однаково. Помилка тиха — на екрані все працює, видно її
-- лише на живому телефоні, — тому вона ловиться накатом, а не оком.
do $$
declare v_missing text;
begin
  select string_agg(event, ', ' order by event) into v_missing
    from public.notification_templates
   where tenant_id is null and channel = 'push' and subject is null;
  if v_missing is not null then
    raise exception 'push-шаблони без заголовка: %', v_missing;
  end if;
end;
$$;
