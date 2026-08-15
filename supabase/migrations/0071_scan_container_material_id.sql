-- ===========================================================================
-- 0071. Сканер ёмкости отдаёт ссылку на засіб, а не только его название
-- ===========================================================================
--
-- На полке у салона наклеен QR ЁМКОСТИ — той самой банки, у которой считается
-- PAO. Штрихкода производителя на ней может не быть вовсе (банку перелили),
-- а `scan_lookup` ищет именно по коду товара или засоба. Значит при
-- инвентаризации мастер сканирует наклейку, а экран должен понять, СТРОКУ
-- КАКОГО ЗАСОБА подсветить.
--
-- До этой миграции `scan_container` возвращал имя засоба текстом. Сопоставлять
-- строку документа по названию нельзя: два засоба одного бренда отличаются
-- одним словом, а уникальность имени — на арендатора, не на систему. Отдаём
-- идентификатор, по которому сопоставление точное.
--
-- Функция пересоздаётся через drop: у функции, возвращающей таблицу, состав
-- колонок нельзя изменить через create or replace. Права выдаются заново
-- явно (правило 7): при create Postgres даёт EXECUTE роли PUBLIC.
-- ===========================================================================

drop function if exists public.scan_container(uuid, text);

create function public.scan_container(p_tenant_id uuid, p_code text)
returns table (
  id uuid, material text, material_id uuid, code text, status public.container_status,
  batch_number text, use_by date, days_left int, expired boolean,
  opened_at timestamptz, volume numeric, unit text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, m.name, m.id, c.code, c.status,
         b.batch_number, c.use_by,
         (c.use_by - current_date)::int,
         coalesce(c.use_by < current_date, false),
         c.opened_at, c.volume, coalesce(c.unit, m.unit)
    from public.material_containers c
    join public.materials m on m.id = c.material_id
    left join public.material_batches b on b.id = c.batch_id
   where c.tenant_id = p_tenant_id
     and c.code = p_code
     and public.tenant_can(p_tenant_id, 'compliance.read')
   limit 1;
$$;

revoke execute on function public.scan_container(uuid, text) from public, anon;
grant  execute on function public.scan_container(uuid, text) to authenticated;

comment on function public.scan_container(uuid, text) is
  'Поиск ёмкости по коду наклейки. Отдаёт material_id, чтобы вызывающий экран '
  'мог сопоставить наклейку со строкой документа точно, а не по названию.';
