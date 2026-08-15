-- 0043. Инспектор видел коммерческую часть приёмок.
--
-- ЧТО БЫЛО. Политика material_batches_read пускала к таблице партий
-- всех, у кого есть compliance.read. У роли inspector это единственное
-- право — значит, инспектор читал material_batches целиком: 8 партий,
-- из них 5 с supplier_id и 5 с note вида «Партія з накладної
-- ПН-2026-0142». Тот же путь дублировался через журнал: политика
-- audit_log_read держала 'material_batches' в белом списке сущностей,
-- доступных без stock.read, а в audit_log.changes лежит полный снимок
-- строки — все 8 записей содержали supplier_id.
--
-- ПОЧЕМУ ЭТО ДЕФЕКТ. По ТЗ инспектор — внешний проверяющий без доступа
-- к коммерческим данным. Партия и срок годности ему нужны (это предмет
-- проверки МОЗ), поставщик и номер накладной — нет.
--
-- ЧЕМ ГРОЗИЛО. Утечка контрагентов и закупочной истории салона любому,
-- кого пустили «показать журналы». Отозвать доступ задним числом нельзя.
--
-- ЧТО СТАЛО. Ровно тот приём, которым 0035 закрыла materials:
--   1) material_batches_read переведена с compliance.read на stock.read.
--      Кто теряет доступ: только inspector (у него нет stock.read).
--      operator, viewer, manager, admin, owner имеют stock.read —
--      для них ничего не меняется. accountant не имел ни того, ни
--      другого. Запись (compliance.write) не тронута: у всех ролей
--      с compliance.write есть и stock.read.
--   2) Инспектору вместо таблицы — представление compliance_batches:
--      партия, материал, номер, срок, дата приёмки. Без supplier_id
--      и без note. Представление НЕ security_invoker (как и
--      compliance_materials/compliance_containers) — оно намеренно
--      идёт мимо RLS базовой таблицы и само режет доступ по
--      tenants_with('compliance.read').
--   3) Из белого списка audit_log_read убрана сущность
--      'material_batches'. Держателям stock.read журнал по партиям
--      по-прежнему виден целиком — первая ветка условия их пускает.
--      Инспектору взамен дано compliance_batch_history: те же события
--      по партиям, но changes очищен от supplier_id и note (в том
--      числе внутри снимков 'created'/'deleted', которые пишет
--      audit_row при insert/delete).
--   4) compliance_containers получило security_barrier — было создано
--      без него, в отличие от compliance_materials. Без барьера
--      планировщик вправе протолкнуть дешёвую пользовательскую
--      функцию в WHERE до фильтра по арендатору и утечь строку через
--      сообщение об ошибке.
--
-- ЗАПЛАТКА ПРАВ (повтор 0036_grants_fix_compliance_views). На Supabase
-- ALTER DEFAULT PRIVILEGES раздаёт всем новым объектам в public права
-- ALL для anon и authenticated. Поэтому после create view обязателен
-- поимённый revoke у public, anon, authenticated и только затем
-- точечный grant select. Иначе новое представление окажется доступно
-- анониму, а «инспекторское» — ещё и на запись.

alter policy material_batches_read on public.material_batches
  using (tenant_id in (select public.tenants_with('stock.read')));

create or replace view public.compliance_batches
with (security_barrier = true) as
select b.id,
       b.tenant_id,
       b.material_id,
       m.name as material_name,
       b.batch_number,
       b.expiry_date,
       b.received_at,
       b.created_at
  from public.material_batches b
  join public.materials m on m.id = b.material_id
 where b.tenant_id in (select public.tenants_with('compliance.read'));

revoke all on public.compliance_batches from public, anon, authenticated;
grant select on public.compliance_batches to authenticated, service_role;

comment on view public.compliance_batches is
  'Партии для инспектора: номер, материал, срок годности, дата приёмки. Без supplier_id и note — коммерческая часть приёмки инспектору не показывается (0043).';

alter view public.compliance_containers set (security_barrier = true);

alter policy audit_log_read on public.audit_log
  using (
    tenant_id in (select public.tenants_with('compliance.read'))
    and (
      tenant_id in (select public.tenants_with('stock.read'))
      or entity = any (array['material_containers','material_documents','tech_cards',
                             'cleaning_tasks','cleaning_entries','sanitation_solutions',
                             'sterilization_cycles'])
    )
  );

create or replace view public.compliance_batch_history
with (security_barrier = true) as
select a.id,
       a.tenant_id,
       a.at,
       a.actor_email,
       a.action,
       a.entity_id,
       a.label as batch_number,
       case
         when a.changes ? 'created'
           then jsonb_set(a.changes, '{created}', (a.changes -> 'created') - 'supplier_id' - 'note')
         when a.changes ? 'deleted'
           then jsonb_set(a.changes, '{deleted}', (a.changes -> 'deleted') - 'supplier_id' - 'note')
         else a.changes - 'supplier_id' - 'note'
       end as changes
  from public.audit_log a
 where a.entity = 'material_batches'
   and a.tenant_id in (select public.tenants_with('compliance.read'));

revoke all on public.compliance_batch_history from public, anon, authenticated;
grant select on public.compliance_batch_history to authenticated, service_role;

comment on view public.compliance_batch_history is
  'История изменений партий для инспектора: та же лента, что в audit_log, но из changes вычищены supplier_id и note (0043).';
