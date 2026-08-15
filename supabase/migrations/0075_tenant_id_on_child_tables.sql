-- ===========================================================================
-- 0075. Четыре таблицы без tenant_id получают tenant_id.
--       Это НАЗВАННОЕ РЕШЕНИЕ шага 3 плана, а не попутная правка
-- ===========================================================================
--
-- ── Что было ──────────────────────────────────────────────────────────────
--
-- Четыре таблицы принадлежат арендатору, но колонки `tenant_id` не имели:
--   stock_receipt_lines, stock_count_lines, variant_materials, import_errors
--
-- Их изолировали одиннадцать политик, каждая — подзапросом к родителю:
--   exists (select 1 from stock_receipts r
--            where r.id = stock_receipt_lines.receipt_id
--              and r.tenant_id in (select tenants_with('stock.read')))
--
-- Утечки это не давало — проверено попыткой. Но нарушало сразу два правила:
--   правило 1: у каждой строки данных есть tenant_id;
--   правило 3: политика читает разобранный токен и в таблицы не ходит.
--
-- Второе — не про чистоту. Такая политика выполняет подзапрос К РОДИТЕЛЬСКОЙ
-- ТАБЛИЦЕ на каждую проверяемую строку. На пустой базе незаметно; на приёмке
-- в двести позиций это двести лишних обращений, и каждое — со своей проверкой
-- политик родителя.
--
-- ── Почему сейчас ─────────────────────────────────────────────────────────
--
-- Во всех четырёх таблицах СЕЙЧАС НОЛЬ СТРОК. Значит перенос стоит ноль:
-- ни простоя, ни переливки, ни риска потерять данные. Через месяц у первого
-- клиента там будут сотни строк, и та же миграция станет операцией с блокировкой.
-- Это ровно та причина, по которой список 1 плана стоит ПЕРЕД первой продажей.
--
-- ── Как сделано, и почему именно так ──────────────────────────────────────
--
-- tenant_id НЕ ПРИНИМАЕТСЯ ОТ ПРИЛОЖЕНИЯ. Он ВЫВОДИТСЯ из родителя триггером
-- перед вставкой и перед изменением.
--
-- Разница принципиальная. Если бы значение приходило снаружи и лишь
-- проверялось, появилась бы новая дыра: строка с ЧУЖИМ receipt_id и СВОИМ
-- tenant_id прошла бы политику (tenant_id свой!) и легла бы в чужой документ.
-- Выведенное значение подделать нельзя: что бы ни прислали, триггер перезапишет
-- его тем, что стоит у родителя.
--
-- Прежние `*_tenant_guard` не трогаем — они проверяют другое: что ссылки
-- строки (материал, вариант, партия) принадлежат тому же арендатору, что
-- и документ. Обе проверки нужны и не заменяют друг друга.
--
-- Одна политика сохраняет подзапрос к родителю осознанно:
-- `stock_count_lines_update` проверяет ещё и `status = 'counting'`, а статус
-- живёт на родителе. Арендатор в ней теперь сравнивается напрямую, статус —
-- подзапросом. Дублировать статус в дочернюю таблицу нельзя: это была бы
-- вторая копия истины, и она разъедется.
-- ===========================================================================

-- ── 1. Колонки ────────────────────────────────────────────────────────────

alter table public.stock_receipt_lines add column if not exists tenant_id uuid;
alter table public.stock_count_lines   add column if not exists tenant_id uuid;
alter table public.variant_materials   add column if not exists tenant_id uuid;
alter table public.import_errors       add column if not exists tenant_id uuid;

-- ── 2. Вывод значения из родителя ─────────────────────────────────────────

create or replace function public.stock_receipt_lines_set_tenant()
returns trigger language plpgsql set search_path to '' as $fn$
begin
  select r.tenant_id into new.tenant_id
    from public.stock_receipts r where r.id = new.receipt_id;
  if new.tenant_id is null then
    raise exception 'приймання % не знайдено — рядок без документа неможливий', new.receipt_id;
  end if;
  return new;
end $fn$;

create or replace function public.stock_count_lines_set_tenant()
returns trigger language plpgsql set search_path to '' as $fn$
begin
  select c.tenant_id into new.tenant_id
    from public.stock_counts c where c.id = new.count_id;
  if new.tenant_id is null then
    raise exception 'інвентаризацію % не знайдено', new.count_id;
  end if;
  return new;
end $fn$;

create or replace function public.variant_materials_set_tenant()
returns trigger language plpgsql set search_path to '' as $fn$
begin
  select v.tenant_id into new.tenant_id
    from public.offering_variants v where v.id = new.variant_id;
  if new.tenant_id is null then
    raise exception 'позицію % не знайдено', new.variant_id;
  end if;
  return new;
end $fn$;

create or replace function public.import_errors_set_tenant()
returns trigger language plpgsql set search_path to '' as $fn$
begin
  select j.tenant_id into new.tenant_id
    from public.import_jobs j where j.id = new.job_id;
  if new.tenant_id is null then
    raise exception 'завдання імпорту % не знайдено', new.job_id;
  end if;
  return new;
end $fn$;

revoke all on function public.stock_receipt_lines_set_tenant() from public, anon, authenticated;
revoke all on function public.stock_count_lines_set_tenant()   from public, anon, authenticated;
revoke all on function public.variant_materials_set_tenant()   from public, anon, authenticated;
revoke all on function public.import_errors_set_tenant()       from public, anon, authenticated;

drop trigger if exists stock_receipt_lines_set_tenant on public.stock_receipt_lines;
create trigger stock_receipt_lines_set_tenant
  before insert or update on public.stock_receipt_lines
  for each row execute function public.stock_receipt_lines_set_tenant();

drop trigger if exists stock_count_lines_set_tenant on public.stock_count_lines;
create trigger stock_count_lines_set_tenant
  before insert or update on public.stock_count_lines
  for each row execute function public.stock_count_lines_set_tenant();

drop trigger if exists variant_materials_set_tenant on public.variant_materials;
create trigger variant_materials_set_tenant
  before insert or update on public.variant_materials
  for each row execute function public.variant_materials_set_tenant();

drop trigger if exists import_errors_set_tenant on public.import_errors;
create trigger import_errors_set_tenant
  before insert or update on public.import_errors
  for each row execute function public.import_errors_set_tenant();

-- ── 3. Заполнение существующих строк ──────────────────────────────────────
-- Сейчас их ноль во всех четырёх, но миграция обязана быть верной и на базе,
-- где они есть: её же накатывают на стенд и на будущие среды.

update public.stock_receipt_lines l set tenant_id = r.tenant_id
  from public.stock_receipts r where r.id = l.receipt_id and l.tenant_id is null;
update public.stock_count_lines l set tenant_id = c.tenant_id
  from public.stock_counts c where c.id = l.count_id and l.tenant_id is null;
update public.variant_materials m set tenant_id = v.tenant_id
  from public.offering_variants v where v.id = m.variant_id and m.tenant_id is null;
update public.import_errors e set tenant_id = j.tenant_id
  from public.import_jobs j where j.id = e.job_id and e.tenant_id is null;

-- ── 4. Ограничения и индексы ──────────────────────────────────────────────

alter table public.stock_receipt_lines
  alter column tenant_id set not null,
  add constraint stock_receipt_lines_tenant_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade;
alter table public.stock_count_lines
  alter column tenant_id set not null,
  add constraint stock_count_lines_tenant_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade;
alter table public.variant_materials
  alter column tenant_id set not null,
  add constraint variant_materials_tenant_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade;
alter table public.import_errors
  alter column tenant_id set not null,
  add constraint import_errors_tenant_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade;

create index if not exists stock_receipt_lines_tenant_idx on public.stock_receipt_lines (tenant_id);
create index if not exists stock_count_lines_tenant_idx   on public.stock_count_lines (tenant_id);
create index if not exists variant_materials_tenant_idx   on public.variant_materials (tenant_id);
create index if not exists import_errors_tenant_idx       on public.import_errors (tenant_id);

-- ── 5. Политики: прямое сравнение вместо подзапроса к родителю ────────────

drop policy if exists stock_receipt_lines_read   on public.stock_receipt_lines;
drop policy if exists stock_receipt_lines_insert on public.stock_receipt_lines;
drop policy if exists stock_receipt_lines_update on public.stock_receipt_lines;
drop policy if exists stock_receipt_lines_delete on public.stock_receipt_lines;

create policy stock_receipt_lines_read on public.stock_receipt_lines
  for select using (tenant_id in (select public.tenants_with('stock.read')));
create policy stock_receipt_lines_insert on public.stock_receipt_lines
  for insert with check (tenant_id in (select public.tenants_with('stock.write')));
create policy stock_receipt_lines_update on public.stock_receipt_lines
  for update using (tenant_id in (select public.tenants_with('stock.write')))
          with check (tenant_id in (select public.tenants_with('stock.write')));
create policy stock_receipt_lines_delete on public.stock_receipt_lines
  for delete using (tenant_id in (select public.tenants_with('stock.write')));

drop policy if exists stock_count_lines_read   on public.stock_count_lines;
drop policy if exists stock_count_lines_update on public.stock_count_lines;

create policy stock_count_lines_read on public.stock_count_lines
  for select using (tenant_id in (select public.tenants_with('stock.read')));
-- Статус остаётся подзапросом: он живёт на родителе, и копировать его сюда
-- значило бы завести вторую копию истины. Арендатор при этом сравнивается
-- напрямую, то есть подзапрос перестал быть единственной защитой.
create policy stock_count_lines_update on public.stock_count_lines
  for update using (
        tenant_id in (select public.tenants_with('stock.write'))
    and exists (select 1 from public.stock_counts c
                 where c.id = stock_count_lines.count_id and c.status = 'counting'))
  with check (tenant_id in (select public.tenants_with('stock.write')));

drop policy if exists variant_materials_read   on public.variant_materials;
drop policy if exists variant_materials_insert on public.variant_materials;
drop policy if exists variant_materials_update on public.variant_materials;
drop policy if exists variant_materials_delete on public.variant_materials;

create policy variant_materials_read on public.variant_materials
  for select using (tenant_id in (select public.tenants_with('catalog.read')));
create policy variant_materials_insert on public.variant_materials
  for insert with check (tenant_id in (select public.tenants_with('catalog.write')));
create policy variant_materials_update on public.variant_materials
  for update using (tenant_id in (select public.tenants_with('catalog.write')))
          with check (tenant_id in (select public.tenants_with('catalog.write')));
create policy variant_materials_delete on public.variant_materials
  for delete using (tenant_id in (select public.tenants_with('catalog.write')));

drop policy if exists import_errors_read on public.import_errors;
create policy import_errors_read on public.import_errors
  for select using (tenant_id in (select public.tenants_with('catalog.read')));

comment on column public.stock_receipt_lines.tenant_id is
  'Выводится триггером из stock_receipts. Приложение его не передаёт: принятое снаружи значение позволило бы положить строку в чужой документ.';
comment on column public.stock_count_lines.tenant_id is
  'Выводится триггером из stock_counts. См. комментарий у stock_receipt_lines.tenant_id.';
comment on column public.variant_materials.tenant_id is
  'Выводится триггером из offering_variants. См. комментарий у stock_receipt_lines.tenant_id.';
comment on column public.import_errors.tenant_id is
  'Выводится триггером из import_jobs. См. комментарий у stock_receipt_lines.tenant_id.';
