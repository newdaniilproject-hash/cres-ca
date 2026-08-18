-- ===========================================================================
-- 0107. Отчёт для проверки печатает состояние нотификации.
-- ===========================================================================
--
-- Продолжение 0106 и отдельный файл по одной причине: здесь переписывается
-- ЧУЖАЯ функция (`compliance_report`, 0041 → 0098) целиком, а там заводились
-- свои колонки. Смешать это в одном файле — значит получить миграцию,
-- которую нельзя откатить по частям.
--
-- ЧТО БЫЛО НЕ ТАК. Отчёт собирает сводку за период: вскрытые ёмкости,
-- розливы, сроки, три санитарных журнала, техкарты. Реестра косметики
-- с состоянием нотификации в нём не было вовсе — то есть документ, который
-- НЕСУТ НА ПРОВЕРКУ, молчал ровно о том, что проверяют в первую очередь
-- после 3 августа 2026 года.
--
-- Раздел берётся из представления `compliance_materials`, а не из таблицы,
-- по той же причине, по которой его читают экраны (0083): инспектору
-- `materials` не отдаётся политикой, и отчёт для него оказался бы пустым.
-- Порядок строк — `order by notification_ok`: проблемные позиции сверху,
-- чтобы проверка видела их сразу, а не искала глазами.
--
-- Остальное тело перенесено из боевой версии ДОСЛОВНО. Правило письма
-- миграций: пишешь `or replace` — прочитай действующее тело и перенеси
-- руками всё, что не собирался трогать (0076 однажды унесла так половину
-- сторожа 0052).
-- ===========================================================================

create or replace function public.compliance_report(p_tenant_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_from     timestamptz := p_from::timestamptz;
  v_to       timestamptz := (p_to + 1)::timestamptz;
  v_commerce boolean;
  v_res      jsonb;
begin
  if not public.tenant_can(p_tenant_id, 'compliance.read') then
    raise exception 'недостатньо прав: compliance.read в орендарі %', p_tenant_id;
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'некоректний період: % — %', p_from, p_to;
  end if;

  -- Период в подписи словом «по», а не тире: `mask_text_pii` внутри
  -- `log_data_access` вырезает длинные последовательности цифр вместе
  -- с пробелами и дефисами, и «01.01.2026 - 31.12.2026» превратилось бы
  -- в «<номер прихований>». Обезличивание подписи отключать нельзя —
  -- значит подпись пишется так, чтобы не выглядеть телефоном.
  perform public.log_data_access(
    p_tenant_id, 'reported', 'compliance_report', null,
    'період ' || to_char(p_from, 'DD.MM.YYYY') || ' по ' || to_char(p_to, 'DD.MM.YYYY'));

  v_commerce := public.tenant_can(p_tenant_id, 'stock.read');

  select jsonb_build_object(
    'tenant', (select jsonb_build_object('id', t.id, 'name', t.name)
                 from public.tenants t where t.id = p_tenant_id),
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'generated_at', now(),

    -- НОВОЕ. Реестр косметики с состоянием нотификации: то, что проверяют
    -- первым. Берётся из представления, а не из таблицы, — по той же
    -- причине, по которой его читают экраны (0083): инспектору таблица
    -- не отдаётся политикой, и отчёт для него оказался бы пустым.
    'cosmetics', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', cm.name, 'brand', cm.brand,
               'country', cm.country_of_origin,
               'notification_code', cm.notification_code,
               'notification_url', cm.notification_url,
               'notification_date', cm.notification_date,
               'confirmed_at', cm.notification_confirmed_at,
               'ok', cm.notification_ok)
             order by cm.notification_ok, cm.name)
        from public.compliance_materials cm
       where cm.tenant_id = p_tenant_id and cm.is_cosmetic and cm.is_active), '[]'::jsonb),

    'containers_opened', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', c.code, 'material', m.name, 'batch', b.batch_number,
               'opened_at', c.opened_at, 'use_by', c.use_by, 'status', c.status)
             order by c.opened_at)
        from public.material_containers c
        join public.materials m on m.id = c.material_id
        left join public.material_batches b on b.id = c.batch_id
       where c.tenant_id = p_tenant_id
         and c.opened_at >= v_from and c.opened_at < v_to), '[]'::jsonb),

    'decanted', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', c.code, 'from_code', pc.code, 'material', m.name,
               'batch', b.batch_number, 'decanted_at', c.decanted_at,
               'volume', c.volume, 'unit', c.unit, 'use_by', c.use_by,
               'label', public.container_label(c.id))
             order by c.decanted_at)
        from public.material_containers c
        join public.materials m on m.id = c.material_id
        left join public.material_containers pc on pc.id = c.parent_id
        left join public.material_batches b on b.id = c.batch_id
       where c.tenant_id = p_tenant_id
         and c.decanted_at >= v_from and c.decanted_at < v_to), '[]'::jsonb),

    'expiring', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', c.code, 'material', m.name, 'use_by', c.use_by,
               'status', c.status, 'days_left', (c.use_by - current_date))
             order by c.use_by)
        from public.material_containers c
        join public.materials m on m.id = c.material_id
       where c.tenant_id = p_tenant_id
         and c.status in ('sealed','opened')
         and c.use_by is not null and c.use_by <= p_to), '[]'::jsonb),

    'cleaning', coalesce((
      select jsonb_agg(x order by x->>'task')
        from (select jsonb_build_object('task', t.name, 'schedule', t.schedule,
                       'done', count(e.id), 'last_at', max(e.performed_at)) x
                from public.cleaning_tasks t
                left join public.cleaning_entries e
                       on e.task_id = t.id
                      and e.performed_at >= v_from and e.performed_at < v_to
               where t.tenant_id = p_tenant_id and t.is_active
               group by t.id, t.name, t.schedule) s), '[]'::jsonb),

    'sanitation', coalesce((
      select jsonb_agg(jsonb_build_object(
               'agent', s.agent_name, 'registration', s.registration,
               'concentration', s.concentration, 'volume', s.volume, 'unit', s.unit,
               'prepared_at', s.prepared_at, 'expires_at', s.expires_at)
             order by s.prepared_at)
        from public.sanitation_solutions s
       where s.tenant_id = p_tenant_id
         and s.prepared_at >= v_from and s.prepared_at < v_to), '[]'::jsonb),

    'sterilization', coalesce((
      select jsonb_agg(jsonb_build_object(
               'device', s.device, 'temperature_c', s.temperature_c,
               'duration_minutes', s.duration_minutes, 'indicator_ok', s.indicator_ok,
               'performed_at', s.performed_at)
             order by s.performed_at)
        from public.sterilization_cycles s
       where s.tenant_id = p_tenant_id
         and s.performed_at >= v_from and s.performed_at < v_to), '[]'::jsonb),

    'tech_cards', coalesce((
      select jsonb_agg(jsonb_build_object('title', tc.title, 'version', tc.version,
                                          'steps', jsonb_array_length(tc.steps))
             order by tc.title)
        from public.tech_cards tc
       where tc.tenant_id = p_tenant_id and tc.is_active), '[]'::jsonb),

    'audit_summary', coalesce((
      select jsonb_object_agg(entity, n)
        from (select a.entity, count(*) n
                from public.audit_log a
               where a.tenant_id = p_tenant_id
                 and a.at >= v_from and a.at < v_to
                 and (v_commerce
                      or a.entity = any (array['material_batches','material_containers',
                                               'material_documents','tech_cards','cleaning_tasks',
                                               'cleaning_entries','sanitation_solutions',
                                               'sterilization_cycles']))
               group by a.entity) q), '{}'::jsonb)
  ) into v_res;

  return v_res;
end;
$function$;

comment on function public.compliance_report(uuid, date, date) is
  'Сводка соответствия Техрегламенту за период. VOLATILE намеренно: пишет строку в журнал доступа (0090), а STABLE-функция изменять данные не может. С 0106 содержит реестр косметики с состоянием нотификации.';

revoke all on function public.compliance_report(uuid, date, date) from public;
revoke all on function public.compliance_report(uuid, date, date) from anon;
revoke all on function public.compliance_report(uuid, date, date) from authenticated;
grant execute on function public.compliance_report(uuid, date, date) to authenticated;
