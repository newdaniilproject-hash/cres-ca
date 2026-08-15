-- ===========================================================================
-- 0067. Предупреждения о сроках: партии и ежедневное пересканирование
-- ===========================================================================
--
-- ЧТО ТРЕБУЕТ ТЗ (3.2): «Push/Email сповіщення за 14 та 7 днів до закінчення
-- терміну придатності ПАРТІЇ або відкритої ємності».
--
-- ЧТО БЫЛО. Предупреждения ставились только по ЁМКОСТЯМ и только триггером
-- на вставку или изменение ёмкости. Два следствия:
--
--   1. ПАРТИИ не отслеживались вообще. Коробка канекалона с истекающим
--      сроком, из которой ещё ни одной банки не вскрыли, не давала
--      ни одного письма. Половина пункта ТЗ не работала.
--   2. Пропущенная строка не восстанавливалась. Если постановку в очередь
--      что-то пропустило (0047 чинила ровно такой случай — отменённая
--      запись занимала ключ дедупликации), она не появлялась уже никогда:
--      периодического пересканирования не существовало.
--
-- ЧТО СТАЛО. Логика вынесена в общую enqueue_expiry_for() — она одинаково
-- работает и для ёмкости, и для партии, различаются только тип ссылки
-- и подпись кода. Старая enqueue_expiry_warnings осталась обёрткой:
-- её зовёт триггер containers_notify, переписывать его незачем.
--
-- Добавлена rescan_expiry_warnings(): раз в сутки проходит все живые
-- ёмкости и все партии с концом срока в ближайшие 14 дней и ставит
-- недостающее. Повторов не будет: notification_outbox уникальна
-- по (tenant_id, dedupe_key), и ключ у каждого предупреждения свой.
--
-- Правило «за 14 днів» не досылается задним числом сохранено: письмо
-- «за 14 днів» о банке, которой осталось три дня, дезинформирует.
-- Догоняющая ветка есть у семидневного порога — она и покрывает случай
-- «завели поздно».
-- ===========================================================================

create or replace function public.enqueue_expiry_for(
  p_tenant   uuid,
  p_ref_type text,
  p_ref_id   uuid,
  p_code     text,
  p_material text,
  p_use_by   date
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r         record;
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
    -- За 14 дней. Срок уже прошёл — не досылаем: см. шапку.
    if (p_use_by - 14)::timestamptz > now() then
      if r.email is not null then
        perform public.enqueue_notification(
          p_tenant, 'cosmetics.expiry_14d', 'email',
          format('%s:%s:d14:%s:%s', p_ref_type, p_ref_id, p_use_by, r.user_id),
          v_payload, (p_use_by - 14)::timestamptz,
          r.user_id, null, null, r.email, p_ref_type, p_ref_id, r.locale);
      end if;
      perform public.enqueue_notification(
        p_tenant, 'cosmetics.expiry_14d', 'push',
        format('%s:%s:d14:push:%s:%s', p_ref_type, p_ref_id, p_use_by, r.user_id),
        v_payload, (p_use_by - 14)::timestamptz,
        r.user_id, null, null, null, p_ref_type, p_ref_id, r.locale);
    end if;

    -- За 7 дней, с догоняющей веткой: завели поздно — уходит сразу.
    if (p_use_by - 7)::timestamptz > now() then
      if r.email is not null then
        perform public.enqueue_notification(
          p_tenant, 'cosmetics.expiry_7d', 'email',
          format('%s:%s:d7:%s:%s', p_ref_type, p_ref_id, p_use_by, r.user_id),
          v_payload, (p_use_by - 7)::timestamptz,
          r.user_id, null, null, r.email, p_ref_type, p_ref_id, r.locale);
      end if;
      perform public.enqueue_notification(
        p_tenant, 'cosmetics.expiry_7d', 'push',
        format('%s:%s:d7:push:%s:%s', p_ref_type, p_ref_id, p_use_by, r.user_id),
        v_payload, (p_use_by - 7)::timestamptz,
        r.user_id, null, null, null, p_ref_type, p_ref_id, r.locale);
    elsif p_use_by >= current_date then
      if r.email is not null then
        perform public.enqueue_notification(
          p_tenant, 'cosmetics.expiry_7d', 'email',
          format('%s:%s:d7:%s:%s', p_ref_type, p_ref_id, p_use_by, r.user_id),
          v_payload, now(),
          r.user_id, null, null, r.email, p_ref_type, p_ref_id, r.locale);
      end if;
      perform public.enqueue_notification(
        p_tenant, 'cosmetics.expiry_7d', 'push',
        format('%s:%s:d7:push:%s:%s', p_ref_type, p_ref_id, p_use_by, r.user_id),
        v_payload, now(),
        r.user_id, null, null, null, p_ref_type, p_ref_id, r.locale);
    end if;
  end loop;
end;
$function$;

revoke all on function public.enqueue_expiry_for(uuid, text, uuid, text, text, date) from public;
revoke all on function public.enqueue_expiry_for(uuid, text, uuid, text, text, date) from anon, authenticated;

-- Старое имя остаётся обёрткой: его зовёт триггер на ёмкостях.
create or replace function public.enqueue_expiry_warnings(
  p_tenant uuid, p_container uuid, p_code text, p_material text, p_use_by date
) returns void
language sql
security definer
set search_path to ''
as $function$
  select public.enqueue_expiry_for(p_tenant, 'container', p_container, p_code, p_material, p_use_by);
$function$;

revoke all on function public.enqueue_expiry_warnings(uuid, uuid, text, text, date) from public;
revoke all on function public.enqueue_expiry_warnings(uuid, uuid, text, text, date) from anon, authenticated;

-- ── Партии: тот же порог, тот же шаблон ────────────────────────────────────

create or replace function public.batches_notify()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_material text;
begin
  select m.name into v_material from public.materials m where m.id = new.material_id;
  perform public.enqueue_expiry_for(
    new.tenant_id, 'batch', new.id,
    new.batch_number, v_material, new.expiry_date);
  return new;
end;
$function$;

revoke all on function public.batches_notify() from public;

drop trigger if exists material_batches_notify on public.material_batches;
create trigger material_batches_notify
  after insert on public.material_batches
  for each row execute function public.batches_notify();

-- Правка срока партии — тоже повод предупредить заново: ключ дедупликации
-- содержит дату, поэтому новая дата даёт новое предупреждение, а старое
-- гасится тем же механизмом, что и у ёмкостей.
drop trigger if exists material_batches_notify_upd on public.material_batches;
create trigger material_batches_notify_upd
  after update on public.material_batches
  for each row when (new.expiry_date is distinct from old.expiry_date)
  execute function public.batches_notify();

-- ── Ежедневное пересканирование ────────────────────────────────────────────

create or replace function public.rescan_expiry_warnings()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r     record;
  v_num integer := 0;
begin
  -- Живые ёмкости: закончившиеся и списанные не предупреждают ни о чём.
  for r in
    select c.tenant_id, c.id, c.code, m.name as material, c.use_by
      from public.material_containers c
      join public.materials m on m.id = c.material_id
     where c.status in ('sealed', 'opened')
       and c.use_by is not null
       and c.use_by >= current_date
       and c.use_by <= current_date + 14
  loop
    perform public.enqueue_expiry_for(
      r.tenant_id, 'container', r.id, r.code, r.material, r.use_by);
    v_num := v_num + 1;
  end loop;

  for r in
    select b.tenant_id, b.id, b.batch_number as code, m.name as material,
           b.expiry_date as use_by
      from public.material_batches b
      join public.materials m on m.id = b.material_id
     where m.is_active
       and b.expiry_date >= current_date
       and b.expiry_date <= current_date + 14
  loop
    perform public.enqueue_expiry_for(
      r.tenant_id, 'batch', r.id, r.code, r.material, r.use_by);
    v_num := v_num + 1;
  end loop;

  return v_num;
end;
$function$;

revoke all on function public.rescan_expiry_warnings() from public;
revoke all on function public.rescan_expiry_warnings() from anon, authenticated;

comment on function public.rescan_expiry_warnings() is
  'Ежедневный обход ёмкостей и партий с концом срока в ближайшие 14 дней. Повторов не даёт: notification_outbox уникальна по (tenant_id, dedupe_key).';

-- Раз в сутки в 06:00 UTC — это 09:00 в Киеве: письмо приходит к началу
-- рабочего дня, а не ночью. Разбор очереди делает существующее задание
-- notifications-dispatch каждые пять минут.
select cron.schedule('expiry-rescan', '0 6 * * *',
  $cron$select public.rescan_expiry_warnings();$cron$);
