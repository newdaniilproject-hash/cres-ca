-- 0048. Получатели предупреждений о сроке считались не по тем правилам.
--
-- ЧТО БЫЛО. enqueue_expiry_warnings выбирала адресатов так:
--   where tm.role <> 'inspector'
--     and exists (select 1 from role_grants rg
--                  where rg.role = tm.role and rg.permission = 'stock.read')
-- То есть смотрела ТОЛЬКО на роль и полностью игнорировала персональные
-- оверрайды tenant_members.permissions.
--
-- ПОЧЕМУ ЭТО ДЕФЕКТ. Права в проекте складываются иначе — источник правды
-- custom_access_token_hook: роль владельца даёт «*»; права роли из
-- role_grants действуют, если персонально не выключены
-- (permissions ->> perm <> 'false'); плюс любое право можно выдать
-- персонально (permissions ->> perm = 'true'), даже если роль его не даёт.
-- Функция не знала ни про выключение, ни про выдачу.
--
-- ЧЕМ ГРОЗИЛО. Сотрудник, которому склад персонально ЗАКРЫЛИ, всё равно
-- получал письма и пуши с номенклатурой и сроками. Сотрудник, которому
-- склад персонально ОТКРЫЛИ (например, бухгалтеру, ведущему приёмку),
-- не получал ничего. До 0034, где owner появился в role_grants, владелец
-- вообще выпадал из рассылки — совпадение, а не расчёт: сейчас функция
-- работает по счастливой случайности.
--
-- ЧТО СТАЛО. Условие повторяет логику custom_access_token_hook:
--   роль owner  -> «*», получает всегда;
--   permissions ->> 'stock.read' = 'true'  -> получает независимо от роли;
--   право от роли действует, если не выключено персонально.
-- Явное исключение inspector убрано намеренно: у роли inspector нет
-- stock.read в role_grants, поэтому она отсеивается общим правилом. Если
-- инспектору когда-нибудь выдадут stock.read персонально — это
-- осознанное решение администратора, и рассылка должна ему следовать,
-- как и весь остальной доступ.
--
-- Проверено исполнением: manager с permissions {"stock.read":"false"} —
-- 0 писем; accountant (роль без stock.read) с {"stock.read":"true"} —
-- 4 письма; owner без оверрайдов — 4 письма.

create or replace function public.enqueue_expiry_warnings(
  p_tenant uuid, p_container uuid, p_code text, p_material text, p_use_by date)
returns void
language plpgsql
security definer
set search_path to ''
as $fn$
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
       and (
            tm.role = 'owner'
         or tm.permissions ->> 'stock.read' = 'true'
         or (
              exists (select 1 from public.role_grants rg
                       where rg.role = tm.role and rg.permission = 'stock.read')
              and coalesce(tm.permissions ->> 'stock.read', 'true') <> 'false'
            )
       )
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
$fn$;

revoke all on function public.enqueue_expiry_warnings(uuid,uuid,text,text,date) from public;
grant execute on function public.enqueue_expiry_warnings(uuid,uuid,text,text,date) to service_role;
