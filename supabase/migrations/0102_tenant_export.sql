-- ===========================================================================
-- 0102. Выгрузка заведения. Обещано клиенту в условиях сделки, не существует.
-- ===========================================================================
--
-- ЧТО ОБЕЩАНО. В условиях первого клиента записано дословно: «его данные —
-- его собственность с выгрузкой в любой момент». Выгрузка была ровно одна —
-- база клиентов (`customers_export`, 0090). Заказы, записи, склад, санитарные
-- журналы, техкарты и финансы не выгружались никак, то есть обещание
-- не выполнялось ни на одном разделе, кроме одного.
--
-- Это не «фича». Продавец, который не может забрать свои данные, привязан
-- к платформе не удобством, а невозможностью уйти, — и первый же вопрос
-- «а если вы закроетесь?» остаётся без ответа.
--
-- ── ПОЧЕМУ ПО РАЗДЕЛАМ, А НЕ ОДНИМ ВЫЗОВОМ ─────────────────────────────────
--
-- Одна функция «отдай всё» вернула бы один jsonb на всё заведение: у салона
-- с двухлетней историей это десятки мегабайт в одном ответе PostgREST,
-- собранные в память целиком. Разделы вызываются отдельно, поэтому ответ
-- ограничен разделом, а приложение склеивает файл у себя.
--
-- ── ПРАВА: КАЖДЫЙ РАЗДЕЛ ПРОСИТ СВОЁ ПРАВО ─────────────────────────────────
--
-- Выгрузка — не отдельная привилегия, а другой способ прочитать то, что
-- человеку и так видно. Поэтому раздел отдаётся по тому же праву, что и его
-- экран: заказы — `orders.read`, склад — `stock.read`, журналы —
-- `compliance.read`, деньги — `finances.read`. Иначе появилось бы право
-- «выгрузить всё», которое обходит все остальные.
--
-- Контакты покупателя внутри заказов и клиентов подчиняются тому же
-- правилу, что и экраны: без `customers.contacts` они уходят В МАСКЕ
-- (0089). Выгрузка, отдающая то, чего не отдаёт экран, — это дыра
-- с кнопкой «скачать».
--
-- ── ЖУРНАЛ ─────────────────────────────────────────────────────────────────
--
-- Каждый вызов пишет строку в журнал доступа (0090) действием `exported`,
-- с названием раздела и числом строк. Выгрузка всего заведения — самое
-- крупное движение данных, какое вообще бывает в продукте; не записать
-- его значило бы оставить журнал доступа неполным ровно в том месте,
-- ради которого он заводился.
-- ===========================================================================

create or replace function public.tenant_export(p_tenant_id uuid, p_section text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
declare
  v_perm     text;
  v_contacts boolean;
  v_rows     jsonb;
  v_n        integer;
begin
  -- Право раздела. Незнакомый раздел — это опечатка в вызове, а не пустая
  -- выгрузка: молча вернуть `[]` значило бы отдать человеку файл, в котором
  -- нет его данных, и он узнает об этом, когда они понадобятся.
  v_perm := case p_section
    when 'tenant'     then 'settings.read'
    when 'catalog'    then 'catalog.read'
    when 'orders'     then 'orders.read'
    when 'bookings'   then 'orders.read'
    when 'customers'  then 'customers.read'
    when 'staff'      then 'orders.read'
    when 'inventory'  then 'stock.read'
    when 'movements'  then 'stock.read'
    when 'journals'   then 'compliance.read'
    when 'techcards'  then 'compliance.read'
    when 'finance'    then 'finances.read'
    else null
  end;
  if v_perm is null then
    raise exception 'невідомий розділ вивантаження: %', p_section;
  end if;
  if not public.tenant_can(p_tenant_id, v_perm) then
    raise exception 'недостатньо прав: % у закладі %', v_perm, p_tenant_id;
  end if;

  v_contacts := public.tenant_can(p_tenant_id, 'customers.contacts');

  if p_section = 'tenant' then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
      select t.id, t.slug, t.name, t.kind, t.status, t.tagline, t.description,
             t.legal_name, t.tax_id, t.contact_email, t.contact_phone,
             t.city, t.address, t.modules, t.created_at, t.activated_at
        from public.tenants t where t.id = p_tenant_id) x;

  elsif p_section = 'catalog' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.title), '[]'::jsonb) into v_rows from (
      select o.id, o.kind, o.status, o.sku, o.slug, o.title, o.subtitle,
             o.description, o.price, o.compare_at, o.currency, o.attributes,
             o.tags, o.listed, o.published_at, o.created_at,
             (select coalesce(jsonb_agg(to_jsonb(v) order by v.position), '[]'::jsonb)
                from (select v2.id, v2.name, v2.sku, v2.options, v2.price, v2.cost,
                             v2.track_stock, v2.stock_qty, v2.barcode, v2.unit,
                             v2.duration_minutes, v2.buffer_minutes, v2.position
                        from public.offering_variants v2
                       where v2.offering_id = o.id) v) as variants
        from public.offerings o where o.tenant_id = p_tenant_id) x;

  elsif p_section = 'orders' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.number), '[]'::jsonb) into v_rows from (
      select o.id, o.number, o.status, o.source,
             o.contact_name,
             case when v_contacts then o.contact_phone else public.mask_phone(o.contact_phone) end as contact_phone,
             case when v_contacts then o.contact_email else public.mask_email(o.contact_email) end as contact_email,
             o.delivery_method, o.delivery_city, o.delivery_branch,
             case when v_contacts then o.delivery_address else null end as delivery_address,
             o.tracking_number, o.comment, o.cancel_reason,
             o.subtotal, o.discount, o.total, o.paid_amount, o.currency,
             o.created_at, o.confirmed_at, o.paid_at, o.shipped_at,
             o.completed_at, o.cancelled_at,
             (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb)
                from (select i2.title, i2.variant_name, i2.unit_price, i2.quantity
                        from public.order_items i2 where i2.order_id = o.id) i) as items
        from public.orders o where o.tenant_id = p_tenant_id) x;

  elsif p_section = 'bookings' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.number), '[]'::jsonb) into v_rows from (
      select b.id, b.number, b.status, b.title, b.variant_name,
             lower(b.period) as starts_at, upper(b.period) as ends_at,
             b.service_ends_at, b.price, b.deposit_due, b.deposit_paid, b.currency,
             b.contact_name,
             case when v_contacts then b.contact_phone else public.mask_phone(b.contact_phone) end as contact_phone,
             b.comment, b.cancel_reason, b.created_at,
             (select s.name from public.staff s where s.id = b.staff_id) as staff_name
        from public.bookings b where b.tenant_id = p_tenant_id) x;

  elsif p_section = 'customers' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]'::jsonb) into v_rows from (
      select c.id, c.name,
             case when v_contacts then c.phone else public.mask_phone(c.phone) end as phone,
             case when v_contacts then c.email else public.mask_email(c.email) end as email,
             c.note, c.tags, c.orders_count, c.total_spent, c.last_order_at, c.created_at
        from public.customers c where c.tenant_id = p_tenant_id) x;

  elsif p_section = 'staff' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]'::jsonb) into v_rows from (
      select s.id, s.name, s.title, s.bio, s.timezone, s.is_active, s.created_at,
             (select coalesce(jsonb_agg(to_jsonb(w) order by w.weekday, w.starts_at), '[]'::jsonb)
                from (select w2.weekday, w2.starts_at, w2.ends_at
                        from public.working_hours w2 where w2.staff_id = s.id) w) as working_hours,
             (select coalesce(jsonb_agg(to_jsonb(o) order by o.starts_at), '[]'::jsonb)
                from (select o2.kind, lower(o2.period) as starts_at,
                             upper(o2.period) as ends_at, o2.note
                        from public.time_off o2 where o2.staff_id = s.id) o) as time_off
        from public.staff s where s.tenant_id = p_tenant_id) x;

  elsif p_section = 'inventory' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]'::jsonb) into v_rows from (
      select m.id, m.name, m.unit, m.category, m.current_stock,
             m.min_stock_threshold, m.cost_per_unit, m.is_active, m.sku,
             m.brand, m.country_of_origin, m.inci, m.is_cosmetic,
             m.notification_code, m.notification_url, m.notification_date,
             m.pao_months, m.created_at,
             (select s.name from public.suppliers s where s.id = m.supplier_id) as supplier,
             (select l.name from public.storage_locations l where l.id = m.location_id) as location,
             (select coalesce(jsonb_agg(to_jsonb(b) order by b.batch_number), '[]'::jsonb)
                from (select b2.batch_number, b2.manufactured_date, b2.expiry_date,
                             b2.received_at, b2.note
                        from public.material_batches b2 where b2.material_id = m.id) b) as batches,
             (select coalesce(jsonb_agg(to_jsonb(c) order by c.code), '[]'::jsonb)
                from (select c2.code, c2.volume, c2.unit, c2.status, c2.opened_at,
                             c2.use_by, c2.disposed_at, c2.decanted_at, c2.pao_months
                        from public.material_containers c2 where c2.material_id = m.id) c) as containers
        from public.materials m where m.tenant_id = p_tenant_id) x;

  elsif p_section = 'movements' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) into v_rows from (
      select mv.id, mv.movement_type, mv.quantity, mv.reference_type,
             mv.note, mv.created_at,
             (select m.name from public.materials m where m.id = mv.material_id) as material,
             (select v.name from public.offering_variants v where v.id = mv.variant_id) as variant
        from public.stock_movements mv where mv.tenant_id = p_tenant_id) x;

  elsif p_section = 'journals' then
    -- Три санитарных журнала одним объектом: по отдельности они бессмысленны,
    -- инспектор смотрит их вместе за период.
    select jsonb_build_object(
      'cleaning', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'task', ct.name, 'schedule', ct.schedule,
                 'performed_at', ce.performed_at, 'note', ce.note) order by ce.performed_at)
          from public.cleaning_entries ce
          join public.cleaning_tasks ct on ct.id = ce.task_id
         where ce.tenant_id = p_tenant_id), '[]'::jsonb),
      'sanitation', coalesce((
        select jsonb_agg(to_jsonb(s) order by s.prepared_at)
          from (select s2.agent_name, s2.registration, s2.concentration, s2.volume,
                       s2.unit, s2.prepared_at, s2.expires_at, s2.note
                  from public.sanitation_solutions s2
                 where s2.tenant_id = p_tenant_id) s), '[]'::jsonb),
      'sterilization', coalesce((
        select jsonb_agg(to_jsonb(s) order by s.performed_at)
          from (select s2.device, s2.temperature_c, s2.duration_minutes,
                       s2.indicator_ok, s2.indicator_note, s2.performed_at, s2.note
                  from public.sterilization_cycles s2
                 where s2.tenant_id = p_tenant_id) s), '[]'::jsonb)
    ) into v_rows;

  elsif p_section = 'techcards' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.title, x.version), '[]'::jsonb) into v_rows from (
      select tc.id, tc.title, tc.version, tc.steps, tc.is_active, tc.created_at
        from public.tech_cards tc where tc.tenant_id = p_tenant_id) x;

  elsif p_section = 'finance' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_on), '[]'::jsonb) into v_rows from (
      select f.id, f.kind, f.amount, f.note, f.occurred_on, f.created_at,
             (select c.name from public.finance_categories c where c.id = f.category_id) as category,
             (select o.number from public.orders o where o.id = f.order_id) as order_number
        from public.finance_records f where f.tenant_id = p_tenant_id) x;
  end if;

  v_rows := coalesce(v_rows, '[]'::jsonb);
  v_n := case when jsonb_typeof(v_rows) = 'array' then jsonb_array_length(v_rows) else 1 end;

  -- Подпись читаемая: по журналу должно быть видно, что именно унесли
  -- и сколько. «exported / tenant.orders / 412 рядків» — это разбор
  -- инцидента без запроса в базу.
  perform public.log_data_access(
    p_tenant_id, 'exported', 'tenant.' || p_section, null,
    v_n::text || ' рядків, контакти: '
      || case when v_contacts then 'відкриті' else 'приховані' end);

  return v_rows;
end;
$fn$;

comment on function public.tenant_export(uuid, text) is
  'Выгрузка раздела заведения одним jsonb. Раздел отдаётся по праву своего экрана, контакты покупателя маскируются без customers.contacts, каждый вызов пишется в журнал доступа.';

-- Правило 7. Три отзыва, потом одна выдача: `authenticated` получает право
-- на каждую новую функцию через `alter default privileges`, и отзыв у public
-- этого не снимает (0036, 0061, 0094, 0095).
revoke all on function public.tenant_export(uuid, text) from public;
revoke all on function public.tenant_export(uuid, text) from anon;
revoke all on function public.tenant_export(uuid, text) from authenticated;
grant execute on function public.tenant_export(uuid, text) to authenticated;
