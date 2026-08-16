-- 19_register_tenant.sql — самостоятельная регистрация заклада
-- (0016, переписана в 0025, слаг чинен в 0027).
--
-- Функция делает две вещи одной транзакцией: заводит заклад и делает
-- позвавшего его владельцем. Обе половины обязаны быть неразрывны —
-- заклад без владельца недоступен никому, включая нас.
--
-- ⚠️ В НАБОРЕ ЕСТЬ ОДНА НАМЕРЕННО КРАСНАЯ СТРОКА (пробел в названии).
-- Она помечена «ПРОВАЛ» через `raise warning`, чтобы прогон дошёл
-- до конца. Разбор — у самой проверки.

\set ON_ERROR_STOP on

\echo '--- 0016: анониму регистрация не выдана вовсе'
-- Правило 7: список того, что открыто анониму, закрытый, и register_tenant
-- в него не входит. Здесь проверяется не текст ошибки, а сам факт отказа.
set role anon;
do $$
begin
  perform public.register_tenant('Магазин Анонима', 'goods', 'Полтава');
  raise exception 'ПРОВАЛ: анонім зареєстрував заклад';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

\echo '--- 0016: вошедший без токена тоже не проходит'
\set QUIET on
select set_config('request.jwt.claims', '{}', false);
\set QUIET off
set role authenticated;
do $$
begin
  perform public.register_tenant('Магазин Без Токена', 'goods', 'Полтава');
  raise exception 'ПРОВАЛ: заклад створено без auth.uid()';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

insert into auth.users (id, email) values
  ('aa190000-0000-0000-0000-000000000001','founder@test.ua')
on conflict (id) do nothing;
\set QUIET on
select test.login('aa190000-0000-0000-0000-000000000001');
\set QUIET off

\echo '--- 0016: название из одной буквы не проходит'
set role authenticated;
do $$
begin
  perform public.register_tenant('A', 'goods', 'Полтава');
  raise exception 'ПРОВАЛ: заклад із назвою в один символ створено';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0016: заклад и владелец появляются ОДНОЙ транзакцией'
select (r.status = 'draft')            as чернетка_ожид_t,
       (r.storefront_enabled = false)  as вітрина_закрита_ожид_t,
       (r.name = 'Пробник')            as назва_ожид_t
  from public.register_tenant('Пробник', 'goods', 'Полтава') r;
reset role;

select tm.role::text as роль_ожид_owner,
       count(*) over () as рядків_ожид_1
  from public.tenant_members tm
  join public.tenants t on t.id = tm.tenant_id
 where t.name = 'Пробник' and tm.user_id = 'aa190000-0000-0000-0000-000000000001';

\echo '--- 0027: первая буква названия не теряется'
-- До 0025/0027 порядок был lower(regexp_replace(translate(...))): заглавные
-- доходили до regexp_replace как есть и вылетали, «Пробник» превращался
-- в «robnyk». Это и есть та проверка, ради которой 0027 написана.
select slug::text as слаг_ожид_probnyk,
       (slug::text = 'probnyk') as збіг_ожид_t
  from public.tenants where name = 'Пробник';

\echo '--- 0016: слаг занят — второй заклад получает суффикс, а не ложится рядом'
-- Слаг это публичный адрес витрины. Две витрины на одном адресе означали бы,
-- что покупатель попадает не туда, куда шёл.
\set QUIET on
select test.login('aa190000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select (r.slug::text <> 'probnyk')      as слаг_інший_ожид_t,
       (r.slug::text like 'probnyk-%')  as суфікс_ожид_t
  from public.register_tenant('Пробник', 'goods', 'Полтава') r;
reset role;

select count(*) as закладів_на_адресі_probnyk_ожид_1
  from public.tenants where slug::text = 'probnyk';

\echo '--- 0016: слаг не длиннее 38 символов, каким бы длинным ни было имя'
\set QUIET on
select test.login('aa190000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select (length(r.slug::text) <= 38) as довжина_ожид_t
  from public.register_tenant(
    'Дуже Довга Назва Закладу Що Точно Не Влізе У Тридцять Вісім Символів',
    'goods', 'Полтава') r;
reset role;

\echo '--- 0016: четвёртый черновик не заводится'
-- «Один человек не может наплодить магазины пачкой»: три черновика —
-- потолок. У пользователя их ровно три (Пробник, Пробник-суффикс, длинный).
\set QUIET on
select test.login('aa190000-0000-0000-0000-000000000001');
\set QUIET off
select count(*) as чернеток_ожид_3
  from public.tenant_members tm
  join public.tenants t on t.id = tm.tenant_id
 where tm.user_id = 'aa190000-0000-0000-0000-000000000001'
   and tm.role = 'owner' and t.status = 'draft';

set role authenticated;
do $$
begin
  perform public.register_tenant('Четвертий Заклад', 'goods', 'Полтава');
  raise exception 'ПРОВАЛ: заведено четвертий чернетковий заклад';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0016: лимит считает ЧЕРНОВИКИ, а не заклады вообще'
-- Опубликовал один — можешь завести следующий. Иначе продавец с тремя
-- работающими магазинами не смог бы открыть четвёртый.
update public.tenants set status = 'active', storefront_enabled = true
 where name = 'Пробник' and slug::text = 'probnyk';
reset role;
\set QUIET on
select test.login('aa190000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select (r.status = 'draft') as четвертий_після_публікації_ожид_t
  from public.register_tenant('Четвертий Заклад', 'goods', 'Полтава') r;
reset role;

\echo '--- 0016: слаг из названия с пробелом — КРАСНАЯ, дефект ниже'
-- ДЕФЕКТ. Таблица translate в register_tenant сдвинута на один символ:
-- исходная строка «абв…ё » длиной 37 знаков, замена
-- «abvgg…__ja__e-» длиной 38 (лишний знак приехал из пары «я → ja»,
-- которую translate поштучно выполнить не может). Из-за сдвига последний
-- разбор пары не совпадает: ПРОБЕЛ переводится в букву «e», а дефис,
-- стоящий в замене последним, не используется никогда.
-- Видно на боевых данных: «Салон Плетіння Кіс» → salonepletinnjekis.
-- Цена: публичный адрес витрины навсегда получает слипшиеся слова
-- с лишними «e» вместо разделителей. Чинится одной правкой строки замены.
\set QUIET on
select test.login('aa190000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
do $$
declare v public.tenants;
begin
  update public.tenants set status = 'active', storefront_enabled = true
   where name = 'Четвертий Заклад';
  v := public.register_tenant('Кава Друга', 'goods', 'Полтава');
  if v.slug::text = 'kava-druga' then
    raise notice 'ok — пробіл став дефісом: %', v.slug;
  else
    raise warning 'ПРОВАЛ: слаг «%» замість «kava-druga» — пробіл перекладено в літеру, таблиця translate зсунута', v.slug;
  end if;
end $$;
reset role;
