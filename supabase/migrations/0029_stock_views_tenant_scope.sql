-- 0029 — остатки и себестоимость чужих магазинов утекали любому вошедшему.
--
-- Тот же класс, что и утечка графиков мастеров из 0010, закрытая в 0013.
-- Там же, в 0013, эти два представления УЖЕ правились — но только от
-- анонима:
--     revoke select on public.stock_low_view   from anon;
--     revoke select on public.stock_value_view from anon;
--     grant  select on ... to authenticated;
-- Комментарий рядом объяснял причину дословно: «сколько денег на складе
-- у соседнего магазина» не должен собираться одним запросом. От анонима
-- закрыли, от вошедшего — нет, а зарегистрироваться на площадке может кто
-- угодно, включая конкурента.
--
-- ПОЧЕМУ ТЕКЛО. Оба представления объявлены security_invoker = true,
-- то есть опираются на RLS нижележащих таблиц. Для materials это надёжно:
-- materials_member_read требует tenant_id in tenants_with('stock.read').
-- А вот offering_variants читается ШИРЕ по замыслу — variants_read (0004)
-- намеренно отдаёт варианты любого опубликованного магазина, иначе
-- не работает витрина. Представление, построенное поверх такой таблицы,
-- наследует её ширину:
--   • stock_value_view отдавал по КАЖДОМУ магазину площадки units,
--     cost_value (себестоимость!), retail_value, out_of_stock, low_stock;
--   • stock_low_view — поштучно, что и насколько заканчивается.
-- Витрине это не нужно: она показывает цену и наличие, а не себестоимость
-- и не то, что у продавца вот-вот кончится.
--
-- ПРАВИЛО, КОТОРОЕ ЗДЕСЬ ПРИМЕНЕНО. Точка чтения обязана отсекать чужое
-- САМА, а не надеяться на политику нижележащей таблицы — ровно так, как
-- CLAUDE.md требует от storefront/search_all/map_tenants («обязаны сами
-- отсекать неопубликованное и вырезать чувствительные поля»). Отчёт
-- по складу — не витрина, и его границей всегда является арендатор.
--
-- security_invoker оставлен: он и должен остаться, чтобы поверх этого
-- фильтра продолжали работать политики таблиц. Фильтр добавлен вторым
-- рубежом, а не вместо них.

create or replace view public.stock_low_view
with (security_invoker = true) as
  select v.tenant_id,
         'variant'::text as kind,
         v.id                        as id,
         o.title || ' · ' || v.name  as title,
         v.unit                      as unit,
         v.stock_qty::numeric        as stock_qty,
         v.min_stock_threshold::numeric as threshold,
         (v.min_stock_threshold - v.stock_qty)::numeric as to_order,
         null::text                  as supplier
    from public.offering_variants v
    join public.offerings o on o.id = v.offering_id
   where v.track_stock and v.is_active
     and v.min_stock_threshold > 0
     and v.stock_qty <= v.min_stock_threshold
     -- ↓ ради этой строки и написана миграция
     and v.tenant_id in (select public.tenants_with('stock.read'))

  union all

  select m.tenant_id,
         'material',
         m.id,
         m.name,
         m.unit,
         m.current_stock,
         m.min_stock_threshold,
         m.min_stock_threshold - m.current_stock,
         s.name
    from public.materials m
    left join public.suppliers s on s.id = m.supplier_id
   where m.is_active
     and m.min_stock_threshold > 0
     and m.current_stock <= m.min_stock_threshold
     -- materials и так закрыт политикой; условие дублирует её намеренно,
     -- чтобы обе половины union читались одним правилом и следующий
     -- редактор не гадал, почему у веток разная защита.
     and m.tenant_id in (select public.tenants_with('stock.read'));

create or replace view public.stock_value_view
with (security_invoker = true) as
  select v.tenant_id,
         sum(v.stock_qty)                                   as units,
         sum(v.stock_qty * coalesce(v.cost, 0))             as cost_value,
         sum(v.stock_qty * coalesce(v.price, 0))            as retail_value,
         count(*) filter (where v.stock_qty <= 0)           as out_of_stock,
         count(*) filter (where v.min_stock_threshold > 0
                            and v.stock_qty <= v.min_stock_threshold) as low_stock
    from public.offering_variants v
   where v.track_stock and v.is_active
     and v.tenant_id in (select public.tenants_with('stock.read'))
   group by v.tenant_id;

-- Правило 7 распространяется и на представления: в 0009 они создавались
-- без единой строки прав, и дыра для анонима прожила до 0013. Повторяем
-- права явно, чтобы состав не зависел от умолчаний Supabase.
revoke all on public.stock_low_view   from public, anon;
revoke all on public.stock_value_view from public, anon;
grant select on public.stock_low_view   to authenticated;
grant select on public.stock_value_view to authenticated;
