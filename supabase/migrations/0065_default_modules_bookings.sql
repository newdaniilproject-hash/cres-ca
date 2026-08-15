-- 0065. «Записи» — пункт нижней панели, значит модуль обязан быть подключён.
--
-- ЗАЧЕМ. Владелец 15.08.2026 определил нижнюю панель кабинета:
-- Склад, Записи, Послуги, Профіль. Пункт панели показывается только
-- если арендатор купил соответствующий модуль (правило «модуль — это
-- что бизнес купил»). Без `bookings` панель схлопывалась до трёх
-- пунктов, и заказанная навигация не собиралась бы ни у кого.
--
-- 0064 добавила в умолчание склад и соответствие; здесь — записи,
-- по той же причине и тем же способом. Финансы и маркетинг остаются
-- за пределами умолчания: они не в панели и не в оплаченной области.

alter table public.tenants
  alter column modules set default array[
    'inventory'::public.tenant_module,
    'compliance'::public.tenant_module,
    'catalog'::public.tenant_module,
    'bookings'::public.tenant_module,
    'orders'::public.tenant_module,
    'customers'::public.tenant_module,
    'storefront'::public.tenant_module
  ];

update public.tenants
   set modules = (
     select array_agg(distinct m order by m)
       from unnest(modules || array['bookings'::public.tenant_module]) as m
   )
 where not (modules @> array['bookings'::public.tenant_module]);
