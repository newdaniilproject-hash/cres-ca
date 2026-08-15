-- 0035 — инспектор видел всю коммерцию заведения. Блокер приёмки.
--
-- ЧТО БЫЛО. ТЗ описывает инспектора дословно как «режим захищеного перегляду…
-- БЕЗ доступу до комерційних чи фінансових даних». В role_grants у роли inspector
-- лежали три права: compliance.read, stock.read и catalog.read. Два последних
-- к режиму защищённого просмотра отношения не имеют — на них висят политики
-- чтения всей товарно-денежной части.
--
-- ПРОВЕРЕНО ПОПЫТКОЙ (под JWT инспектора, форма custom_access_token_hook):
--   materials          8 строк, вместе с колонкой cost_per_unit — закупочные цены;
--   suppliers          3 строки — с кем работает салон и по каким контактам;
--   stock_movements   27 строк — весь оборот склада;
--   material_barcodes  6, storage_locations 3, stock_receipts 2 — приходы и места;
--   stock_low_view     2 строки — что заканчивается, то есть что вот-вот закупят;
--   audit_log         51 строка, в том числе 8 записей о заведении материалов
--                     с cost_per_unit внутри changes — история закупочных цен.
-- Товаров у клиента ещё нет; как только появятся, к этому же списку по catalog.read
-- добавятся offerings.price, offering_variants.cost/price и stock_value_view
-- с cost_value/retail_value, то есть оценка склада в деньгах.
--
-- ЧЕМ ГРОЗИЛО. Инспектор — это внешний человек, которому владелец даёт доступ
-- на время проверки. Отдавать проверяющему закупочные цены, поставщиков и оборот
-- нельзя ни по ТЗ, ни по здравому смыслу: это коммерческая тайна заведения,
-- и продаётся ровно обратное — «показать журналы, не показывая бизнес».
--
-- ЧТО СТАЛО. Права инспектора сужены до одного compliance.read. Проверено заранее,
-- что политики material_batches, material_containers, material_documents,
-- tech_cards, cleaning_tasks и всех трёх санитарных журналов висят именно
-- на compliance.read — значит инспектор их НЕ теряет.
-- Теряет он только реестр косметики (materials висит на stock.read), а он по ТЗ
-- обязателен. Реестр возвращается отдельным представлением compliance_materials
-- БЕЗ денежных колонок: нет cost_per_unit, нет supplier_id, нет current_stock
-- и min_stock_threshold (остаток и точка дозаказа — тоже коммерческая информация).
-- Рядом заведено compliance_containers — ёмкости со сроками и партиями одной
-- строкой, чтобы интерфейсу проверки не приходилось джойнить materials.
--
-- ПОЧЕМУ ПРЕДСТАВЛЕНИЯ, А НЕ НОВОЕ ПРАВО. Право пришлось бы вешать на materials
-- целиком — то есть снова отдать cost_per_unit. Колонку в RLS не скроешь:
-- политика фильтрует строки, а не поля. Представление — единственный способ
-- отдать реестр без себестоимости, не трогая саму таблицу.
-- Оба представления намеренно НЕ security_invoker: они сами фильтруют по
-- tenants_with('compliance.read') и потому обязаны обходить RLS materials.
-- Отсюда же security_barrier = true — чтобы дешёвая функция в WHERE снаружи
-- не выполнилась раньше фильтра арендатора.
--
-- ЧТО ЭТО ДАЁТ ОСТАЛЬНЫМ РОЛЯМ. Ничего: у owner/admin/manager/operator/viewer
-- уже есть stock.read, представления для них — подмножество того, что и так видно.
-- У accountant нет compliance.read, для него оба представления пусты.
-- Проверено исполнением по каждой роли до и после: числа совпали строка в строку,
-- изменилась только колонка inspector.

-- ── 1. Сужение прав инспектора ────────────────────────────────────────────────
delete from public.role_grants
 where role = 'inspector'
   and permission in ('stock.read', 'catalog.read');

-- ── 2. Реестр косметики без денег ─────────────────────────────────────────────
create or replace view public.compliance_materials as
select m.id, m.tenant_id, m.name, m.unit, m.category, m.brand, m.country_of_origin,
       m.inci, m.notification_code, m.pao_months, m.is_cosmetic, m.sku,
       m.is_active, m.created_at, m.updated_at
  from public.materials m
 where m.tenant_id in (select public.tenants_with('compliance.read'));

alter view public.compliance_materials set (security_barrier = true);

-- Правило 5 действует и для представлений: Supabase раздаёт новым объектам
-- ALL для anon и authenticated через default privileges. Сужаем руками.
revoke all on public.compliance_materials from public;
revoke all on public.compliance_materials from anon;
grant select on public.compliance_materials to authenticated;

-- ── 3. Ёмкости со сроками и партиями, тоже без денег ──────────────────────────
create or replace view public.compliance_containers as
select c.id, c.tenant_id, c.code, c.material_id, m.name as material_name,
       c.batch_id, b.batch_number, b.expiry_date as batch_expiry,
       c.parent_id, c.volume, c.unit, c.status, c.opened_at, c.opened_by,
       c.use_by, c.disposed_at, c.note, c.created_at
  from public.material_containers c
  join public.materials m on m.id = c.material_id
  left join public.material_batches b on b.id = c.batch_id
 where c.tenant_id in (select public.tenants_with('compliance.read'));

alter view public.compliance_containers set (security_barrier = true);

revoke all on public.compliance_containers from public;
revoke all on public.compliance_containers from anon;
grant select on public.compliance_containers to authenticated;

-- ── 4. audit_log: журнал изменений тоже содержит цены ─────────────────────────
--
-- Политика висела на одном compliance.read, а значит инспектор читал историю
-- изменений ВСЕХ 16 аудируемых таблиц, включая materials с cost_per_unit
-- в теле changes, suppliers, offerings и tenant_members.
--
-- Список сделан БЕЛЫМ, а не чёрным, сознательно: когда триггер audit_row
-- навесят на следующую таблицу, она по умолчанию окажется скрыта от того,
-- у кого нет stock.read, а не открыта. Ошибка в сторону молчания, а не утечки.
-- Тот, у кого stock.read есть (все остальные роли), видит журнал целиком —
-- как и раньше, ни одна строка не потеряна.
drop policy if exists audit_log_read on public.audit_log;

create policy audit_log_read on public.audit_log
  for select to authenticated
  using (
    tenant_id in (select public.tenants_with('compliance.read'))
    and (
      tenant_id in (select public.tenants_with('stock.read'))
      or entity = any (array['material_batches','material_containers','material_documents',
                             'tech_cards','cleaning_tasks','cleaning_entries',
                             'sanitation_solutions','sterilization_cycles'])
    )
  );

-- ЧЕГО ЭТА МИГРАЦИЯ НЕ ДЕЛАЕТ. Инспектор больше не видит историю изменений
-- самого реестра (entity = 'materials'): там в одной строке changes лежат и
-- inci с названием, и cost_per_unit, а разделить их фильтром строк невозможно.
-- Если проверяющему когда-нибудь понадобится история состава — это отдельное
-- представление над audit_log с вычищенным ключом cost_per_unit в changes,
-- а не ослабление этой политики.
