-- 0060. Инспектор обязан видеть статус нотификации целиком.
--
-- ЗАЧЕМ. 0059 добавила ссылку на реестр МОЗ и дату внесения, но
-- представления, через которые смотрит инспектор, отдавали только код.
-- Проверка по одному коду невозможна: инспектор должен открыть запись
-- в реестре. Пункт 3.1 ТЗ называет это «поле з посиланням/кодом».
-- Дата изготовления партии — туда же: срок годности без даты выпуска
-- инспектору нечем сверить.
--
-- Новые колонки вставляются в СЕРЕДИНУ списка, поэтому create or replace
-- не проходит (Postgres умеет только дописывать в конец). Представления
-- пересоздаются через drop — зависимостей у них нет, читает их только
-- кабинет инспектора.
--
-- ВАЖНО (грабли 0036): после пересоздания права сбрасываются, а Supabase
-- держит alter default privileges, отдающий ALL ролям anon и authenticated.
-- Права выставляются явно в 0061 — она обязательна и идёт следом.

drop view if exists public.compliance_materials;
drop view if exists public.compliance_batches;

create view public.compliance_materials as
  select id, tenant_id, name, unit, category, brand, country_of_origin,
         inci, notification_code, notification_url, notification_date,
         pao_months, is_cosmetic, sku, is_active, created_at, updated_at
    from public.materials
   where tenant_id in (select public.tenants_with('compliance.read'));

create view public.compliance_batches as
  select b.id, b.tenant_id, b.material_id, m.name as material_name,
         b.batch_number, b.manufactured_date, b.expiry_date,
         b.received_at, b.created_at
    from public.material_batches b
    join public.materials m on m.id = b.material_id
   where b.tenant_id in (select public.tenants_with('compliance.read'));
