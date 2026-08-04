-- 0004_hardening.sql
-- Устранение всего, что нашёл анализатор Supabase после первых трёх миграций.
-- Это не косметика: две из четырёх находок — реальные дыры, и обе мои.
--
-- 1. ФУНКЦИИ БЫЛИ ОТКРЫТЫ АНОНИМАМ. В 0003 я выдал право на выполнение
--    роли authenticated, но не отобрал право по умолчанию: Postgres выдаёт
--    EXECUTE роли PUBLIC на каждую новую функцию автоматически. В итоге
--    record_stock_movement и остальные были вызываемы через /rest/v1/rpc/
--    без входа вообще. Данные бы не утекли — внутри стоит проверка
--    auth.uid() и tenant_can() — но открытая точка входа в чужую систему
--    учёта это открытая точка входа. Отбираем явно.
--
-- 2. ДВЕ ПОЛИТИКИ НА ОДНО ЧТЕНИЕ. Политика «for all» распространяется
--    и на SELECT тоже, поэтому на десяти таблицах на каждом чтении
--    выполнялись ДВЕ политики вместо одной. Это ровно та болезнь, которую
--    анализатор нашёл в базе прошлого проекта и о которой написано
--    в docs/PERFORMANCE.md — и я её сюда занёс. Разделяем: чтение одной
--    политикой, запись отдельными на insert/update/delete.
--
-- 3. ВНЕШНИЕ КЛЮЧИ БЕЗ ИНДЕКСА. Девять штук, включая receipt_id и count_id
--    в stock_movements — те самые, про которые в 0002 написан комментарий,
--    что такие ключи индексировать обязательно. Написал правило и сам же
--    его не выполнил в соседнем файле.
--
-- 4. ИЗМЕНЯЕМЫЙ search_path у variant_available — функция может быть
--    подменена через окружение вызывающего. Фиксируем.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Забираем право выполнения у анонимов
-- ─────────────────────────────────────────────────────────────────────────────
-- Порядок важен: сначала отобрать у public (это включает и anon,
-- и authenticated), потом вернуть только тем, кому положено.

revoke execute on function
  public.record_stock_movement(uuid, public.stock_movement_type, numeric, uuid, uuid, text, uuid, uuid, uuid, text, text),
  public.reserve_stock(uuid, uuid, int, text, uuid, timestamptz),
  public.release_reservation(uuid),
  public.commit_reservation(uuid, text),
  public.consume_materials_for_variant(uuid, uuid, numeric, text, uuid, text),
  public.apply_stock_receipt(uuid),
  public.start_stock_count(uuid, uuid[]),
  public.apply_stock_count(uuid)
  from public, anon;

grant execute on function
  public.record_stock_movement(uuid, public.stock_movement_type, numeric, uuid, uuid, text, uuid, uuid, uuid, text, text),
  public.reserve_stock(uuid, uuid, int, text, uuid, timestamptz),
  public.release_reservation(uuid),
  public.commit_reservation(uuid, text),
  public.consume_materials_for_variant(uuid, uuid, numeric, text, uuid, text),
  public.apply_stock_receipt(uuid),
  public.start_stock_count(uuid, uuid[]),
  public.apply_stock_count(uuid)
  to authenticated;

-- Триггерная функция: вызывается системой при регистрации, снаружи
-- дёргать её незачем никому.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Хелперы RLS читают только токен и ничего не меняют — им публичный
-- доступ безвреден и нужен: их вызывают сами политики.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Фиксируем search_path
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.variant_available(v public.offering_variants)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when v.track_stock then greatest(v.stock_qty - v.reserved_qty, 0) else 2147483647 end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Индексы на внешние ключи
-- ─────────────────────────────────────────────────────────────────────────────
-- Только те, по которым реально удаляют или ищут родителя. Правило из
-- docs/PERFORMANCE.md остаётся в силе: индекс «на всякий случай» не заводим.
-- Здесь все девять оправданы: движение всегда смотрят «по документу»
-- и «кто сделал», а профиль сотрудника при увольнении удаляется.

create index stock_movements_receipt_fkey_idx    on public.stock_movements (receipt_id)    where receipt_id is not null;
create index stock_movements_count_fkey_idx      on public.stock_movements (count_id)      where count_id is not null;
create index stock_movements_created_by_idx      on public.stock_movements (created_by);
create index stock_reservations_created_by_idx   on public.stock_reservations (created_by);
create index stock_receipts_created_by_idx       on public.stock_receipts (created_by);
create index stock_receipts_applied_by_idx       on public.stock_receipts (applied_by) where applied_by is not null;
create index stock_counts_started_by_idx         on public.stock_counts (started_by);
create index stock_counts_applied_by_idx         on public.stock_counts (applied_by) where applied_by is not null;
create index tenant_members_invited_by_idx       on public.tenant_members (invited_by)  where invited_by is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Одно чтение — одна политика
-- ─────────────────────────────────────────────────────────────────────────────
-- Два изменения на каждой таблице:
--   а) «публичное чтение» и «чтение участником» сливаются в одну политику
--      через OR — вместо двух, выполняющихся на каждой строке;
--   б) политика «for all» заменяется тремя (insert / update / delete),
--      чтобы она перестала участвовать в SELECT.

-- tenants ─────────────────────────────────────────────────────────────────────
drop policy tenants_public_read on public.tenants;
drop policy tenants_member_read on public.tenants;

create policy tenants_read on public.tenants
  for select to anon, authenticated
  using (
    (status = 'active' and storefront_enabled)
    or id in (select public.my_tenants())
    or (select public.is_platform_staff())
  );

-- tenant_domains ──────────────────────────────────────────────────────────────
drop policy tenant_domains_public_read on public.tenant_domains;
drop policy tenant_domains_manage      on public.tenant_domains;

create policy tenant_domains_read on public.tenant_domains
  for select to anon, authenticated
  using (
    verified_at is not null
    or tenant_id in (select public.tenants_with('settings.write'))
  );

create policy tenant_domains_insert on public.tenant_domains
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('settings.write')));

create policy tenant_domains_update on public.tenant_domains
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('settings.write')))
  with check (tenant_id in (select public.tenants_with('settings.write')));

create policy tenant_domains_delete on public.tenant_domains
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('settings.write')));

-- tenant_members ──────────────────────────────────────────────────────────────
drop policy tenant_members_write on public.tenant_members;

create policy tenant_members_insert on public.tenant_members
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('team.write')));

create policy tenant_members_update on public.tenant_members
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('team.write')))
  with check (tenant_id in (select public.tenants_with('team.write')));

create policy tenant_members_delete on public.tenant_members
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('team.write')));

-- offerings ───────────────────────────────────────────────────────────────────
drop policy offerings_public_read  on public.offerings;
drop policy offerings_member_read  on public.offerings;
drop policy offerings_member_write on public.offerings;

create policy offerings_read on public.offerings
  for select to anon, authenticated
  using (
    tenant_id in (select public.tenants_with('catalog.read'))
    or (
      status = 'active'
      and exists (
        select 1 from public.tenants t
         where t.id = offerings.tenant_id
           and t.status = 'active'
           and t.storefront_enabled
      )
    )
  );

create policy offerings_insert on public.offerings
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('catalog.write')));

create policy offerings_update on public.offerings
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('catalog.write')))
  with check (tenant_id in (select public.tenants_with('catalog.write')));

create policy offerings_delete on public.offerings
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('catalog.write')));

-- offering_variants ───────────────────────────────────────────────────────────
drop policy variants_public_read  on public.offering_variants;
drop policy variants_member_read  on public.offering_variants;
drop policy variants_member_write on public.offering_variants;

create policy variants_read on public.offering_variants
  for select to anon, authenticated
  using (
    tenant_id in (select public.tenants_with('catalog.read'))
    or (
      is_active
      and exists (
        select 1 from public.offerings o
          join public.tenants t on t.id = o.tenant_id
         where o.id = offering_variants.offering_id
           and o.status = 'active'
           and t.status = 'active'
           and t.storefront_enabled
      )
    )
  );

create policy variants_insert on public.offering_variants
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('catalog.write')));

create policy variants_update on public.offering_variants
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('catalog.write')))
  with check (tenant_id in (select public.tenants_with('catalog.write')));

create policy variants_delete on public.offering_variants
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('catalog.write')));

-- offering_media ──────────────────────────────────────────────────────────────
drop policy media_public_read  on public.offering_media;
drop policy media_member_write on public.offering_media;

create policy media_read on public.offering_media
  for select to anon, authenticated
  using (
    tenant_id in (select public.tenants_with('catalog.read'))
    or exists (
      select 1 from public.offerings o
        join public.tenants t on t.id = o.tenant_id
       where o.id = offering_media.offering_id
         and o.status = 'active'
         and t.status = 'active'
         and t.storefront_enabled
    )
  );

create policy media_insert on public.offering_media
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('catalog.write')));

create policy media_update on public.offering_media
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('catalog.write')))
  with check (tenant_id in (select public.tenants_with('catalog.write')));

create policy media_delete on public.offering_media
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('catalog.write')));

-- collections ─────────────────────────────────────────────────────────────────
drop policy collections_public_read  on public.collections;
drop policy collections_member_write on public.collections;

create policy collections_read on public.collections
  for select to anon, authenticated
  using (
    tenant_id in (select public.tenants_with('catalog.read'))
    or (
      is_active
      and exists (
        select 1 from public.tenants t
         where t.id = collections.tenant_id
           and t.status = 'active'
           and t.storefront_enabled
      )
    )
  );

create policy collections_insert on public.collections
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('catalog.write')));

create policy collections_update on public.collections
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('catalog.write')))
  with check (tenant_id in (select public.tenants_with('catalog.write')));

create policy collections_delete on public.collections
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('catalog.write')));

-- collection_items ────────────────────────────────────────────────────────────
drop policy collection_items_write on public.collection_items;

create policy collection_items_insert on public.collection_items
  for insert to authenticated
  with check (exists (
    select 1 from public.collections c
     where c.id = collection_items.collection_id
       and c.tenant_id in (select public.tenants_with('catalog.write'))
  ));

create policy collection_items_update on public.collection_items
  for update to authenticated
  using (exists (
    select 1 from public.collections c
     where c.id = collection_items.collection_id
       and c.tenant_id in (select public.tenants_with('catalog.write'))
  ))
  with check (exists (
    select 1 from public.collections c
     where c.id = collection_items.collection_id
       and c.tenant_id in (select public.tenants_with('catalog.write'))
  ));

create policy collection_items_delete on public.collection_items
  for delete to authenticated
  using (exists (
    select 1 from public.collections c
     where c.id = collection_items.collection_id
       and c.tenant_id in (select public.tenants_with('catalog.write'))
  ));

-- materials ───────────────────────────────────────────────────────────────────
drop policy materials_member_write on public.materials;

create policy materials_insert on public.materials
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('stock.write')));

create policy materials_update on public.materials
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('stock.write')))
  with check (tenant_id in (select public.tenants_with('stock.write')));

create policy materials_delete on public.materials
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('stock.write')));

-- variant_materials ───────────────────────────────────────────────────────────
drop policy variant_materials_write on public.variant_materials;

create policy variant_materials_insert on public.variant_materials
  for insert to authenticated
  with check (exists (
    select 1 from public.offering_variants v
     where v.id = variant_materials.variant_id
       and v.tenant_id in (select public.tenants_with('catalog.write'))
  ));

create policy variant_materials_update on public.variant_materials
  for update to authenticated
  using (exists (
    select 1 from public.offering_variants v
     where v.id = variant_materials.variant_id
       and v.tenant_id in (select public.tenants_with('catalog.write'))
  ))
  with check (exists (
    select 1 from public.offering_variants v
     where v.id = variant_materials.variant_id
       and v.tenant_id in (select public.tenants_with('catalog.write'))
  ));

create policy variant_materials_delete on public.variant_materials
  for delete to authenticated
  using (exists (
    select 1 from public.offering_variants v
     where v.id = variant_materials.variant_id
       and v.tenant_id in (select public.tenants_with('catalog.write'))
  ));

-- stock_receipt_lines ─────────────────────────────────────────────────────────
drop policy stock_receipt_lines_write on public.stock_receipt_lines;

create policy stock_receipt_lines_insert on public.stock_receipt_lines
  for insert to authenticated
  with check (exists (
    select 1 from public.stock_receipts r
     where r.id = stock_receipt_lines.receipt_id
       and r.tenant_id in (select public.tenants_with('stock.write'))
  ));

create policy stock_receipt_lines_update on public.stock_receipt_lines
  for update to authenticated
  using (exists (
    select 1 from public.stock_receipts r
     where r.id = stock_receipt_lines.receipt_id
       and r.tenant_id in (select public.tenants_with('stock.write'))
  ))
  with check (exists (
    select 1 from public.stock_receipts r
     where r.id = stock_receipt_lines.receipt_id
       and r.tenant_id in (select public.tenants_with('stock.write'))
  ));

create policy stock_receipt_lines_delete on public.stock_receipt_lines
  for delete to authenticated
  using (exists (
    select 1 from public.stock_receipts r
     where r.id = stock_receipt_lines.receipt_id
       and r.tenant_id in (select public.tenants_with('stock.write'))
  ));
