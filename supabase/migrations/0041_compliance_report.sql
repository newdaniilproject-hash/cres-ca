-- 0041 — наборы данных для отчёта проверки одним вызовом.
--
-- ЧТО БЫЛО. Отчёта нет ни в каком виде: чтобы собрать «что делалось по
-- санитарии за период», интерфейсу пришлось бы сделать семь отдельных
-- запросов к семи таблицам и сшить их у себя. Каждый такой запрос — это ещё
-- одно место, где можно забыть фильтр по арендатору или по периоду.
--
-- ЧТО СТАЛО. compliance_report(p_tenant_id, p_from, p_to) отдаёт один jsonb:
--   tenant, period, generated_at,
--   containers_opened  — что вскрывали за период (код, средство, партия, срок);
--   decanted           — что разливали в дозаторы, вместе с готовой строкой
--                        наклейки из container_label();
--   expiring           — что истекает к концу периода и ещё в обороте;
--   cleaning           — по каждой активной задаче: расписание, сколько раз
--                        выполнено, когда последний раз (задача без единой
--                        отметки видна с нулём — это и есть главный вопрос
--                        проверяющего, поэтому left join, а не inner);
--   sanitation         — приготовленные дезрастворы;
--   sterilization      — циклы стерилизации с температурой и индикатором;
--   tech_cards         — действующие регламенты;
--   audit_summary      — сколько событий по каждой сущности за период.
--
-- PDF ЭТА ФУНКЦИЯ НЕ ДЕЛАЕТ И НЕ ДОЛЖНА: вёрстка — выше уровня базы.
--
-- ПРАВА. Требуется compliance.read того же арендатора, проверка первым делом.
-- Денежных полей в ответе нет ни одного: ни cost_per_unit, ни price, ни сумм —
-- проверено регулярным выражением по всему телу ответа.
-- ОТДЕЛЬНО ПРО audit_summary. Функция security definer, то есть RLS
-- на audit_log внутри неё НЕ действует, и первая версия честно вернула
-- инспектору счётчики по materials и suppliers — ровно то, что закрыла 0035.
-- Найдено проверкой исполнением до применения. Поэтому здесь повторён тот же
-- белый список сущностей: у кого нет stock.read, тот видит только санитарную
-- часть. Проверено: инспектор получает 4 сущности (tech_cards, cleaning_tasks,
-- material_batches, material_containers), viewer — все 10, как и раньше.
-- ВЫВОД НА БУДУЩЕЕ: любая security definer функция над audit_log обязана
-- повторять фильтр политики руками, иначе она её отменяет.

create or replace function public.compliance_report(p_tenant_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
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
    raise exception 'недостаточно прав: compliance.read в арендаторе %', p_tenant_id;
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'некорректный период: % — %', p_from, p_to;
  end if;

  v_commerce := public.tenant_can(p_tenant_id, 'stock.read');

  select jsonb_build_object(
    'tenant', (select jsonb_build_object('id', t.id, 'name', t.name)
                 from public.tenants t where t.id = p_tenant_id),
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'generated_at', now(),

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

revoke all on function public.compliance_report(uuid, date, date) from public, anon;
grant execute on function public.compliance_report(uuid, date, date) to authenticated, service_role;
