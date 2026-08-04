-- 0013_leak_fixes.sql
-- Три настоящие утечки между арендаторами, найденные аудитом 0009–0012.
-- Все три — мои, и все три одной природы: политика `using (true)`
-- написана «чтобы витрина видела», без вопроса «а чья витрина».
--
-- 1. working_hours были открыты анониму БЕЗ проверки арендатора: любой
--    мог выгрузить графики всех мастеров всех магазинов, включая
--    неопубликованные и черновики. Это разведка конкурента одним GET.
--    Аргумент «график нужен витрине» неверен: витрина не читает эту
--    таблицу — слоты считает available_slots(), которая security definer
--    и сама проверяет опубликованность.
--
-- 2. staff_services — то же самое, плюс нарушение правила 1: у таблицы
--    вообще не было tenant_id. Именно поэтому политику и написали
--    как `true` — не по чему было фильтровать. Правило 1 существует
--    ровно для этого: без tenant_id корректную политику не написать.
--
-- 3. collection_items — та же болезнь: подборки продавца были видны
--    всем без проверки магазина.
--
-- Плюс: представления склада показывали анониму себестоимость и оценку
-- запасов. Товары опубликованного магазина видны публично законно,
-- но «сколько денег лежит на складе у соседа» — не публичная цифра.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Графики работы
-- ─────────────────────────────────────────────────────────────────────────────

drop policy working_hours_read on public.working_hours;

create policy working_hours_read on public.working_hours
  for select to anon, authenticated
  using (
    tenant_id in (select public.tenants_with('orders.read'))
    or exists (
      select 1 from public.tenants t
       where t.id = working_hours.tenant_id
         and t.status = 'active'
         and t.storefront_enabled
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Услуги мастера: добавляем арендатора (правило 1) и чиним политику
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.staff_services
  add column tenant_id uuid references public.tenants(id) on delete cascade;

update public.staff_services ss
   set tenant_id = s.tenant_id
  from public.staff s
 where s.id = ss.staff_id;

alter table public.staff_services alter column tenant_id set not null;

create index staff_services_tenant_idx on public.staff_services (tenant_id);

-- Арендатор строки обязан совпадать с арендатором мастера: иначе
-- запись можно было бы «переписать» на чужой магазин.
create or replace function public.staff_services_tenant_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.staff where id = new.staff_id;
  if new.tenant_id is distinct from v_tenant then
    raise exception 'арендатор строки не совпадает с арендатором мастера';
  end if;
  return new;
end;
$$;

create trigger staff_services_tenant_guard
  before insert or update on public.staff_services
  for each row execute function public.staff_services_tenant_guard();

revoke execute on function public.staff_services_tenant_guard() from public, anon, authenticated;

drop policy staff_services_read   on public.staff_services;
drop policy staff_services_write  on public.staff_services;
drop policy staff_services_delete on public.staff_services;

create policy staff_services_read on public.staff_services
  for select to anon, authenticated
  using (
    tenant_id in (select public.tenants_with('orders.read'))
    or exists (
      select 1 from public.tenants t
       where t.id = staff_services.tenant_id
         and t.status = 'active'
         and t.storefront_enabled
    )
  );

create policy staff_services_insert on public.staff_services
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('team.write')));

create policy staff_services_delete on public.staff_services
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('team.write')));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Подборки продавца
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.collection_items
  add column tenant_id uuid references public.tenants(id) on delete cascade;

update public.collection_items ci
   set tenant_id = c.tenant_id
  from public.collections c
 where c.id = ci.collection_id;

alter table public.collection_items alter column tenant_id set not null;

create index collection_items_tenant_idx on public.collection_items (tenant_id);

create or replace function public.collection_items_tenant_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.collections where id = new.collection_id;
  if new.tenant_id is distinct from v_tenant then
    raise exception 'арендатор строки не совпадает с арендатором подборки';
  end if;
  return new;
end;
$$;

create trigger collection_items_tenant_guard
  before insert or update on public.collection_items
  for each row execute function public.collection_items_tenant_guard();

revoke execute on function public.collection_items_tenant_guard() from public, anon, authenticated;

drop policy collection_items_read on public.collection_items;

create policy collection_items_read on public.collection_items
  for select to anon, authenticated
  using (
    tenant_id in (select public.tenants_with('catalog.read'))
    or exists (
      select 1 from public.tenants t
       where t.id = collection_items.tenant_id
         and t.status = 'active'
         and t.storefront_enabled
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Характеристики категорий: видны, только если категория активна
-- ─────────────────────────────────────────────────────────────────────────────
-- Это справочник платформы, а не данные продавца, поэтому утечки нет.
-- Но `using (true)` — плохой шаблон: он приучает писать политики,
-- которые ничего не проверяют.

drop policy category_attributes_read on public.category_attributes;

create policy category_attributes_read on public.category_attributes
  for select to anon, authenticated
  using (exists (select 1 from public.categories c
                  where c.id = category_attributes.category_id and c.is_active));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Себестоимость и оценка склада — не публичные цифры
-- ─────────────────────────────────────────────────────────────────────────────
-- Представления построены правильно (security_invoker), но право SELECT
-- на них по умолчанию досталось анониму. «Сколько денег на складе
-- у соседнего магазина» — ровно тот отчёт, который не должен собираться
-- одним анонимным запросом.

revoke select on public.stock_low_view   from anon;
revoke select on public.stock_value_view from anon;
grant  select on public.stock_low_view   to authenticated;
grant  select on public.stock_value_view to authenticated;

-- variant_available анониму не нужна: в политиках она не участвует.
revoke execute on function public.variant_available(public.offering_variants) from anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Мелочи, найденные тем же аудитом
-- ─────────────────────────────────────────────────────────────────────────────

-- Внешний ключ без покрывающего индекса: уникальный индекс шаблонов
-- начинается с coalesce(tenant_id, …) и обычный FK не покрывает.
create index notification_templates_tenant_idx
  on public.notification_templates (tenant_id) where tenant_id is not null;

-- Событие order.delivered рассылалось, но шаблона к нему не было —
-- обработчик не нашёл бы текст.
insert into public.notification_templates (tenant_id, event, channel, locale, subject, body) values
  (null, 'order.delivered', 'email', 'uk', 'Замовлення №{{number}} доставлено',
   'Замовлення №{{number}} доставлено. Дякуємо за покупку! Будемо вдячні за відгук.'),
  (null, 'order.delivered', 'push',  'uk', null,
   'Замовлення №{{number}} доставлено')
on conflict do nothing;
