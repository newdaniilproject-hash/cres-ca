-- 0033 — две дыры, найденные проверкой попыткой по шагу 3 (14.08.2026).
-- Обе закрываются здесь; третья находка (сироты в audit_log) осознанно
-- не трогается — см. комментарий в конце файла.
--
-- Проверено до правки: ни `tenant_domains`, ни `track_order` не используются
-- НИ ОДНОЙ строкой кода приложения (grep по app/, components/, lib/, proxy.ts —
-- ноль совпадений; middleware.ts в проекте нет). Разрешения арендатора
-- по hostname не существует: арендатор определяется только слагом в пути,
-- app/t/[slug]/page.tsx зовёт storefront(p_slug). Поэтому обе правки
-- не меняют поведение работающего приложения.

-- ── 1. tenant_domains: четвёртая политика, фактически using(true) ──────────
--
-- Было: using ((verified_at is not null) or (tenant_id in (select tenants_with('settings.write'))))
-- Первая ветка не фильтрует по арендатору вообще. Для anon и для любого
-- вошедшего это означало: весь список подтверждённых доменов платформы,
-- включая арендаторов в статусе draft, вместе со связкой hostname → tenant_id.
-- То есть перечисление всех клиентов площадки (домен заводит тот, кто платит)
-- и готовые uuid арендаторов для дальнейших запросов.
--
-- Правило приёмки 8 говорит: using(true) на таблице С ДАННЫМИ АРЕНДАТОРОВ —
-- ошибка приёмки. Законных исключений ровно три, и это общие справочники
-- (role_grants, order_status_transitions, booking_status_transitions).
-- tenant_domains к ним не относится: это данные арендатора.
--
-- Стало: читает только тот, кто имеет право на настройки своего арендатора.
drop policy if exists tenant_domains_read on public.tenant_domains;

create policy tenant_domains_read on public.tenant_domains
  for select to authenticated
  using (tenant_id in (select public.tenants_with('settings.read')));

-- ВНИМАНИЕ НА БУДУЩЕЕ. Когда появятся свои домены продавцов, разрешение
-- hostname → tenant_id ПОНАДОБИТСЯ анониму. Возвращать публичное чтение
-- таблицы для этого НЕЛЬЗЯ — это вернёт ту же утечку. Правильный путь:
-- security definer функция resolve_domain(hostname), которая отдаёт ровно
-- один tenant_id и только для verified_at is not null и tenants.status =
-- 'active'. Это будет ДЕВЯТАЯ анонимная точка, а список объявлен закрытым:
-- значит отдельное решение и запись в КОНСПЕКТЫ.md, а не побочный эффект.

-- ── 2. track_order: отдавал заказы неопубликованного арендатора ────────────
--
-- Функция фильтровала по слагу, номеру и телефону, но не проверяла состояние
-- арендатора. Номера заказов пер-арендаторные и начинаются с единицы, так что
-- единственным секретом оставался телефон покупателя: по утёкшей базе телефонов
-- перебирались статусы, суммы и ТТН чужих заказов — в том числе у магазина,
-- который ещё не открыт.
--
-- Добавляется только `t.status = 'active'`. `storefront_enabled` СОЗНАТЕЛЬНО
-- не добавляется: продавец может временно снять витрину с публикации, и
-- покупатель с уже оформленным заказом обязан сохранить возможность его
-- отследить. Статус арендатора — про то, работает ли заведение вообще;
-- витрина — про то, показывать ли каталог. Это разные вопросы.
create or replace function public.track_order(p_tenant_slug citext, p_number bigint, p_phone text)
returns table(number bigint, status public.order_status, total numeric,
              currency character, tracking_number text, created_at timestamptz)
language sql
stable
security definer
set search_path to ''
as $function$
  select o.number, o.status, o.total, o.currency, o.tracking_number, o.created_at
    from public.orders o
    join public.tenants t on t.id = o.tenant_id
   where t.slug = p_tenant_slug
     and t.status = 'active'
     and o.number = p_number
     and o.contact_phone is not null
     and o.contact_phone = p_phone
   limit 1;
$function$;

-- Правило 7: явный revoke/grant после каждой функции. Postgres выдаёт EXECUTE
-- роли PUBLIC на каждую новую функцию, и это трижды ловилось анализатором
-- в этом проекте. track_order остаётся одной из восьми анонимных точек.
revoke all on function public.track_order(citext, bigint, text) from public;
grant execute on function public.track_order(citext, bigint, text) to anon, authenticated;

-- ── 3. Чего эта миграция НЕ делает и почему ───────────────────────────────
--
-- В audit_log лежат 12 строк с tenant_id трёх арендаторов, которых больше
-- нет в tenants (это единственная таблица с tenant_id БЕЗ внешнего ключа).
-- Строки недостижимы ни одной политикой: tenants_with() никогда не вернёт
-- удалённого арендатора. Соблазн — удалить их. Делать этого НЕЛЬЗЯ:
-- audit_log неизменяем по устройству (нет политик UPDATE и DELETE плюс
-- триггер, безусловно роняющий попытку), и обходить собственную защиту
-- журнала ради уборки — хуже самой проблемы.
-- Правильное место для решения — шаг 7 (сроки хранения) и delete_my_account:
-- либо журнал чистится вместе с удалением арендатора в той же транзакции,
-- либо признаётся, что записи об удалённых живут вечно, и это пишется
-- в политику конфиденциальности. Это решение владельца, не миграции.
