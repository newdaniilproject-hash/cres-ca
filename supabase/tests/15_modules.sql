-- 15_modules.sql — модули арендатора (миграция 0020, умолчание правлено
-- в 0064 и 0065).
--
-- Модуль отвечает на вопрос «что этот бизнес купил», роль — «что этому
-- человеку можно». Оси разные, и смешивать их нельзя: иначе доступ
-- к оплаченному разделу выдаётся правкой прав сотрудника.
--
-- Где стоит сам замок. В базе гейта по модулю НЕТ ни одной политики —
-- раздел прячет оболочка кабинета (lib/tenant.ts, hasModule). База даёт
-- ей две вещи: набор в tenants.modules и его доставку в токен хуком.
-- Значит проверять надо ровно их, и проверять ПОПЫТКОЙ: отключить модуль
-- и потребовать, чтобы tenant_has_module ответил «нет». Если хук
-- перестанет класть modules в токен (а он это уже терял — 0079 про
-- форму permissions), функция будет молча отвечать «нет» на ВСЁ,
-- и кабинет схлопнется до трёх пунктов у всех сразу.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('aa150000-0000-0000-0000-000000000001','modules@test.ua')
on conflict (id) do nothing;

\set QUIET on
select test.login('aa150000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select (r.name = 'Майстерня Модулів') as заклад_створено_ожид_t
  from public.register_tenant('Майстерня Модулів', 'services', 'Полтава') r;
reset role;

\echo '--- 0064/0065: новый заклад получает склад, журналы и записи'
-- Дефект, который правили 0064 и 0065: умолчание досталось от маркетплейса
-- и склада в нём не было. Продукт продаётся как «склад для майстрів»,
-- а первый же зарегистрированный владелец раздела «Склад» не видел.
select (modules @> array['inventory','compliance','bookings',
                         'catalog','orders','customers','storefront']::public.tenant_module[])
         as повний_набір_ожид_t,
       not (modules @> array['finance']::public.tenant_module[])   as фінансів_немає_ожид_t,
       not (modules @> array['marketing']::public.tenant_module[]) as маркетингу_немає_ожид_t
  from public.tenants where name = 'Майстерня Модулів';

\echo '--- 0020: токен несёт модули, и tenant_has_module читает их, а не таблицу'
\set QUIET on
select test.login('aa150000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select public.tenant_has_module(t.id, 'inventory') as склад_ожид_t,
       public.tenant_has_module(t.id, 'compliance') as журнали_ожид_t,
       public.tenant_has_module(t.id, 'finance')   as фінанси_ожид_f,
       public.tenant_has_module(t.id, 'marketing') as маркетинг_ожид_f
  from public.tenants t where t.name = 'Майстерня Модулів';

\echo '--- 0020: раздел, которого нет в modules, не отдаётся'
-- Главная проверка набора: отключаем склад обычным UPDATE (так это делает
-- смена тарифа), пересобираем токен и требуем «нет». Права владельца
-- при этом не трогаем — если бы модуль и право были одной осью,
-- ответ остался бы «да».
set role authenticated;
update public.tenants
   set modules = array_remove(modules, 'inventory'::public.tenant_module)
 where name = 'Майстерня Модулів';
reset role;
\set QUIET on
select test.login('aa150000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select public.tenant_has_module(t.id, 'inventory') as склад_після_відключення_ожид_f,
       public.tenant_can(t.id, 'stock.read')       as право_stock_read_ожид_t,
       public.tenant_can(t.id, 'stock.write')      as право_stock_write_ожид_t
  from public.tenants t where t.name = 'Майстерня Модулів';
reset role;

\echo '--- 0020: возвращаем модуль — раздел появляется обратно'
\set QUIET on
select test.login('aa150000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
update public.tenants
   set modules = modules || 'inventory'::public.tenant_module
 where name = 'Майстерня Модулів';
reset role;
\set QUIET on
select test.login('aa150000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select public.tenant_has_module(t.id, 'inventory') as склад_повернувся_ожид_t
  from public.tenants t where t.name = 'Майстерня Модулів';

\echo '--- 0020: чужой заклад не даёт ни одного модуля'
-- «Магазин 1» — не наш; в токене его нет вовсе, и ответ обязан быть «нет»,
-- а не ошибка и не «да по умолчанию».
select public.tenant_has_module('aaaaaaaa-0000-0000-0000-000000000001','inventory')
         as чужий_склад_ожид_f,
       public.tenant_has_module('aaaaaaaa-0000-0000-0000-000000000091','catalog')
         as чужий_каталог_ожид_f;
reset role;

\echo '--- 0020: анониму модулей не положено'
set role anon;
select public.tenant_has_module('aaaaaaaa-0000-0000-0000-000000000001','storefront')
         as анонім_ожид_f;
reset role;

\echo '--- 0020: модуля вне перечня не существует'
-- Набор закрыт типом, а не строкой: «купили crm» нельзя вписать
-- в арендатора мимо решения о том, что такой модуль вообще есть.
\set QUIET on
select test.login('aa150000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
do $$
begin
  update public.tenants set modules = modules || 'crm'::public.tenant_module
   where name = 'Майстерня Модулів';
  raise exception 'ПРОВАЛ: закладу видано неіснуючий модуль';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0020: чужие модули не переключишь'
do $$
begin
  update public.tenants set modules = array['finance']::public.tenant_module[]
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if not found then
    raise notice 'ok — чужий заклад не знайдено під політикою';
  else
    raise exception 'ПРОВАЛ: перемкнули модулі чужого закладу';
  end if;
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

select (modules @> array['inventory']::public.tenant_module[]) as магазин1_склад_на_місці_ожид_t
  from public.tenants where id = 'aaaaaaaa-0000-0000-0000-000000000001';
