-- 0046. Ёмкость (и не только) могла ссылаться на чужой материал.
--
-- ЧТО БЫЛО. На material_containers.material_id / batch_id / parent_id не
-- висело ни одного tenant-guard-триггера. RLS проверяет только
-- material_containers.tenant_id — «своя» ли строка. На что она ССЫЛАЕТСЯ,
-- не проверял никто.
--
-- ПОЧЕМУ ЭТО ДЕФЕКТ. Мастер арендатора A, зная uuid материала арендатора B
-- (uuid светятся в ссылках, экспортах, логах), вставляет ёмкость СВОЕГО
-- арендатора со ссылкой на ЧУЖОЙ материал и партию. Строка проходит RLS
-- (tenant_id = A), а дальше её читают представление compliance_containers
-- (не security_invoker) и функция scan_container (security definer) —
-- оба идут мимо RLS базовых таблиц и радостно подставляют name и
-- batch_number из арендатора B.
-- Воспроизведено до этой миграции под JWT мастера A:
--   insert into material_containers(tenant_id=A, material_id=<B>, batch_id=<B>) -- прошёл
--   select * from compliance_containers where code='C-ATTACK';
--   -- «СЕКРЕТНА СИРОВАТКА Б / партія SECRET-B-01»
--
-- ЧЕМ ГРОЗИЛО. Чтение чужой номенклатуры и номеров партий по одному uuid,
-- без единого нарушения RLS. Плюс мусор в чужой аналитике и в отчётах
-- МОЗ: ёмкость арендатора A ссылается на партию арендатора B.
--
-- ЧТО СТАЛО. Тот же приём, что уже применён в проекте для
-- collection_items_tenant_guard и staff_services_tenant_guard: BEFORE
-- INSERT OR UPDATE триггер, который сверяет tenant_id строки с tenant_id
-- того, на что она ссылается, и падает при расхождении. Закрыты все
-- перечисленные ссылки:
--   material_containers  -> material_id, batch_id, parent_id
--   material_batches     -> material_id
--   material_documents   -> material_id
--   material_barcodes    -> material_id
--   stock_receipt_lines  -> material_id, batch_id, variant_id (арендатор
--                           берётся у приёмки: своей колонки tenant_id
--                           у строк приёмки нет)
--   variant_materials    -> сверяются арендаторы позиции и расходника
--                           (своей колонки tenant_id у рецептуры нет)
--
-- Функции намеренно НЕ security definer — ровно как оба существующих
-- охранника. Побочный эффект полезен: если ссылка указывает на строку,
-- невидимую вызывающему по RLS, подзапрос вернёт NULL и триггер упадёт.
-- Правило «fail closed». Легитимные вставки от этого не страдают: все
-- роли, которым RLS разрешает писать в эти таблицы (compliance.write,
-- compliance.journal.write, stock.write, catalog.write), имеют и
-- stock.read/catalog.read, то есть свои материалы и позиции видят.
-- Служебные пути (apply_stock_receipt, decant_container и прочие
-- security definer) выполняются от владельца и RLS не ограничены.
--
-- Проверено после применения: атака из отчёта отбивается на всех четырёх
-- сущностях, легитимный розлив и легитимная вставка своей ёмкости
-- проходят (row_count = 1).

create or replace function public.material_containers_tenant_guard()
returns trigger language plpgsql set search_path to '' as $fn$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.materials where id = new.material_id;
  if new.tenant_id is distinct from v_tenant then
    raise exception 'арендатор ёмкости не совпадает с арендатором расходника';
  end if;

  if new.batch_id is not null then
    select tenant_id into v_tenant from public.material_batches where id = new.batch_id;
    if new.tenant_id is distinct from v_tenant then
      raise exception 'арендатор ёмкости не совпадает с арендатором партии';
    end if;
  end if;

  if new.parent_id is not null then
    select tenant_id into v_tenant from public.material_containers where id = new.parent_id;
    if new.tenant_id is distinct from v_tenant then
      raise exception 'арендатор ёмкости не совпадает с арендатором материнской ёмкости';
    end if;
  end if;

  return new;
end; $fn$;

create or replace function public.material_batches_tenant_guard()
returns trigger language plpgsql set search_path to '' as $fn$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.materials where id = new.material_id;
  if new.tenant_id is distinct from v_tenant then
    raise exception 'арендатор партии не совпадает с арендатором расходника';
  end if;
  return new;
end; $fn$;

create or replace function public.material_documents_tenant_guard()
returns trigger language plpgsql set search_path to '' as $fn$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.materials where id = new.material_id;
  if new.tenant_id is distinct from v_tenant then
    raise exception 'арендатор документа не совпадает с арендатором расходника';
  end if;
  return new;
end; $fn$;

create or replace function public.material_barcodes_tenant_guard()
returns trigger language plpgsql set search_path to '' as $fn$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.materials where id = new.material_id;
  if new.tenant_id is distinct from v_tenant then
    raise exception 'арендатор штрихкода не совпадает с арендатором расходника';
  end if;
  return new;
end; $fn$;

create or replace function public.stock_receipt_lines_tenant_guard()
returns trigger language plpgsql set search_path to '' as $fn$
declare v_receipt uuid; v_tenant uuid;
begin
  select tenant_id into v_receipt from public.stock_receipts where id = new.receipt_id;
  if v_receipt is null then
    raise exception 'приёмка % не найдена', new.receipt_id;
  end if;

  if new.material_id is not null then
    select tenant_id into v_tenant from public.materials where id = new.material_id;
    if v_receipt is distinct from v_tenant then
      raise exception 'арендатор строки приёмки не совпадает с арендатором расходника';
    end if;
  end if;

  if new.variant_id is not null then
    select tenant_id into v_tenant from public.offering_variants where id = new.variant_id;
    if v_receipt is distinct from v_tenant then
      raise exception 'арендатор строки приёмки не совпадает с арендатором позиции';
    end if;
  end if;

  if new.batch_id is not null then
    select tenant_id into v_tenant from public.material_batches where id = new.batch_id;
    if v_receipt is distinct from v_tenant then
      raise exception 'арендатор строки приёмки не совпадает с арендатором партии';
    end if;
  end if;

  return new;
end; $fn$;

create or replace function public.variant_materials_tenant_guard()
returns trigger language plpgsql set search_path to '' as $fn$
declare v_variant uuid; v_material uuid;
begin
  select tenant_id into v_variant  from public.offering_variants where id = new.variant_id;
  select tenant_id into v_material from public.materials         where id = new.material_id;
  if v_variant is null or v_variant is distinct from v_material then
    raise exception 'арендатор рецептуры не совпадает: позиция и расходник из разных арендаторов';
  end if;
  return new;
end; $fn$;

revoke all on function public.material_containers_tenant_guard()  from public;
revoke all on function public.material_batches_tenant_guard()     from public;
revoke all on function public.material_documents_tenant_guard()   from public;
revoke all on function public.material_barcodes_tenant_guard()    from public;
revoke all on function public.stock_receipt_lines_tenant_guard()  from public;
revoke all on function public.variant_materials_tenant_guard()    from public;

grant execute on function public.material_containers_tenant_guard()  to authenticated, service_role;
grant execute on function public.material_batches_tenant_guard()     to authenticated, service_role;
grant execute on function public.material_documents_tenant_guard()   to authenticated, service_role;
grant execute on function public.material_barcodes_tenant_guard()    to authenticated, service_role;
grant execute on function public.stock_receipt_lines_tenant_guard()  to authenticated, service_role;
grant execute on function public.variant_materials_tenant_guard()    to authenticated, service_role;

drop trigger if exists material_containers_tenant_guard on public.material_containers;
create trigger material_containers_tenant_guard
before insert or update on public.material_containers
for each row execute function public.material_containers_tenant_guard();

drop trigger if exists material_batches_tenant_guard on public.material_batches;
create trigger material_batches_tenant_guard
before insert or update on public.material_batches
for each row execute function public.material_batches_tenant_guard();

drop trigger if exists material_documents_tenant_guard on public.material_documents;
create trigger material_documents_tenant_guard
before insert or update on public.material_documents
for each row execute function public.material_documents_tenant_guard();

drop trigger if exists material_barcodes_tenant_guard on public.material_barcodes;
create trigger material_barcodes_tenant_guard
before insert or update on public.material_barcodes
for each row execute function public.material_barcodes_tenant_guard();

drop trigger if exists stock_receipt_lines_tenant_guard on public.stock_receipt_lines;
create trigger stock_receipt_lines_tenant_guard
before insert or update on public.stock_receipt_lines
for each row execute function public.stock_receipt_lines_tenant_guard();

drop trigger if exists variant_materials_tenant_guard on public.variant_materials;
create trigger variant_materials_tenant_guard
before insert or update on public.variant_materials
for each row execute function public.variant_materials_tenant_guard();
