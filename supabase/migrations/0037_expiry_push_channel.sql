-- 0037 — предупреждения о сроке годности уходили только на почту.
--
-- ЧТО БЫЛО. enqueue_expiry_warnings ставила в очередь ровно два уведомления,
-- и оба с каналом 'email'. При этом в notification_templates лежат готовые
-- шаблоны cosmetics.expiry_7d/push и cosmetics.expiry_14d/push — заведены,
-- переведены и ни разу не использованы: в notification_outbox нет ни одной
-- строки с channel = 'push' вообще (только email: 4 строки предупреждений
-- и 3 письма по заказам).
--
-- ПОЧЕМУ ЭТО ДЕФЕКТ. ТЗ обещает push/email, и это не украшение: письмо про
-- «залишилось 7 днів» мастер прочитает вечером или не прочитает никогда,
-- а телефон в кармане звякает в смену, когда банкой ещё можно распорядиться.
-- Шаблоны в базе есть — то есть канал считался сделанным. Опять «сделано,
-- но не работает»: наличие шаблона никем не проверялось на исполнение.
--
-- ЧЕМ ГРОЗИЛО. Просроченная косметика на рабочем месте — это замечание
-- проверки и риск для клиента. Предупреждение, которое пришло не туда,
-- где человек работает, равно отсутствию предупреждения.
--
-- ЧТО СТАЛО. Рядом с каждой постановкой email ставится push с тем же
-- payload, тем же send_after и тем же получателем.
--
-- КЛЮЧ ДЕДУПЛИКАЦИИ — САМОЕ ОПАСНОЕ МЕСТО. notification_outbox уникальна по
-- (tenant_id, dedupe_key), а enqueue_notification делает on conflict do nothing.
-- Возьми push тот же ключ, что и email — вторая вставка молча провалилась бы,
-- и вместо «двух каналов» получился бы один, случайно выбранный порядком строк.
-- Поэтому у push ключ с отдельным сегментом:
--   email: container:<id>:d7:<use_by>:<user>
--   push:  container:<id>:d7:push:<use_by>:<user>
-- Ключи email оставлены ПОБУКВЕННО прежними намеренно: в очереди уже лежат
-- 3 неотправленные строки со старыми ключами, и смена формата означала бы
-- повторную постановку тех же предупреждений — то есть дубли писем клиенту.
--
-- ПОПУТНО. Условие `p.email is not null` вынесено из выборки получателей
-- внутрь email-веток. Раньше сотрудник без почты не получал ВООБЩЕ ничего;
-- теперь он не получает письма, но получает push. Для email поведение
-- не изменилось: строка с пустым to_email по-прежнему не создаётся.
--
-- ПРОВЕРЕНО ИСПОЛНЕНИЕМ (в транзакции с откатом), две ёмкости:
--   срок через 5 дней  → 2 строки pending: email d7 + push d7, обе send_after = сегодня
--                        (сработала догоняющая ветка, 14-дневная пропущена — верно);
--   срок через 30 дней → 4 строки pending: email d14 + push d14 (send_after +16 дн)
--                        и email d7 + push d7 (send_after +23 дн).
-- Ключи всех четырёх пар различны, ни одна вставка не была съедена
-- дедупликацией. Повторный вызов новых строк не создаёт.

create or replace function public.enqueue_expiry_warnings(p_tenant uuid, p_container uuid, p_code text, p_material text, p_use_by date)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record;
  v_payload jsonb;
begin
  if p_use_by is null then
    return;
  end if;

  v_payload := jsonb_build_object(
    'material', coalesce(p_material, '—'),
    'code',     coalesce(p_code, '—'),
    'use_by',   to_char(p_use_by, 'DD.MM.YYYY'));

  for r in
    select tm.user_id, p.email, coalesce(p.locale, 'uk') as locale
      from public.tenant_members tm
      join public.profiles p on p.id = tm.user_id
     where tm.tenant_id = p_tenant
       and tm.role <> 'inspector'
       and exists (
         select 1 from public.role_grants rg
          where rg.role = tm.role and rg.permission = 'stock.read')
  loop
    -- За 14 дней. Если этот срок уже прошёл — не досылаем задним
    -- числом: предупреждение «за 14 днів» о банке, которой осталось
    -- три дня, дезинформирует.
    if (p_use_by - 14)::timestamptz > now() then
      if r.email is not null then
        perform public.enqueue_notification(
          p_tenant, 'cosmetics.expiry_14d', 'email',
          format('container:%s:d14:%s:%s', p_container, p_use_by, r.user_id),
          v_payload, (p_use_by - 14)::timestamptz,
          r.user_id, null, null, r.email, 'container', p_container, r.locale);
      end if;
      perform public.enqueue_notification(
        p_tenant, 'cosmetics.expiry_14d', 'push',
        format('container:%s:d14:push:%s:%s', p_container, p_use_by, r.user_id),
        v_payload, (p_use_by - 14)::timestamptz,
        r.user_id, null, null, null, 'container', p_container, r.locale);
    end if;

    -- За 7 дней. Если банку завели, когда до конца срока осталось
    -- меньше недели, предупреждение уходит сразу: молчать о ней
    -- до истечения — худший из вариантов.
    if (p_use_by - 7)::timestamptz > now() then
      if r.email is not null then
        perform public.enqueue_notification(
          p_tenant, 'cosmetics.expiry_7d', 'email',
          format('container:%s:d7:%s:%s', p_container, p_use_by, r.user_id),
          v_payload, (p_use_by - 7)::timestamptz,
          r.user_id, null, null, r.email, 'container', p_container, r.locale);
      end if;
      perform public.enqueue_notification(
        p_tenant, 'cosmetics.expiry_7d', 'push',
        format('container:%s:d7:push:%s:%s', p_container, p_use_by, r.user_id),
        v_payload, (p_use_by - 7)::timestamptz,
        r.user_id, null, null, null, 'container', p_container, r.locale);
    elsif p_use_by >= current_date then
      if r.email is not null then
        perform public.enqueue_notification(
          p_tenant, 'cosmetics.expiry_7d', 'email',
          format('container:%s:d7:%s:%s', p_container, p_use_by, r.user_id),
          v_payload, now(),
          r.user_id, null, null, r.email, 'container', p_container, r.locale);
      end if;
      perform public.enqueue_notification(
        p_tenant, 'cosmetics.expiry_7d', 'push',
        format('container:%s:d7:push:%s:%s', p_container, p_use_by, r.user_id),
        v_payload, now(),
        r.user_id, null, null, null, 'container', p_container, r.locale);
    end if;
  end loop;
end;
$function$;

-- Правило 5: функция вызывается только триггером containers_guard (security
-- definer) и диспетчером. Прямой вызов из клиента не нужен ни anon, ни
-- authenticated — и раньше EXECUTE у них был выдан по умолчанию.
revoke all on function public.enqueue_expiry_warnings(uuid, uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.enqueue_expiry_warnings(uuid, uuid, text, text, date) to service_role;
