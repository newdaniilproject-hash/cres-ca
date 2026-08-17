-- 11_search_geo.sql — поиск, гео и витрина (миграция 0016; справочник
-- специальностей и его синонимы — 0020).
--
-- Почему этот набор понадобился. 0016 открывает АНОНИМУ четыре точки:
-- search_all, map_tenants, active_cities, storefront. Каждая обязана сама
-- отсекать неопубликованное и вырезать чувствительные поля (CLAUDE.md,
-- правило 7) — RLS их не прикрывает, они security definer. До сих пор
-- ни один сценарий этого не проверял: 05 звал их и печатал результат,
-- а «функция вернула строку» ничего не доказывает.
--
-- Здесь каждое обещание проверяется ПОПЫТКОЙ его нарушить: закрываем
-- витрину и требуем, чтобы магазин пропал из выдачи; спрашиваем ИНН
-- через storefront; ищем чужой город; просим черновик по слагу.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────
-- Фикстура заводится обычным путём: register_tenant (иначе проверялось бы
-- то, чего в бою не бывает), потом обычный UPDATE под правом settings.write
-- — ровно так публикует витрину экран настроек.
-- ─────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email)
values ('aa110000-0000-0000-0000-000000000001','iryna@test')
on conflict (id) do nothing;

\set QUIET on
select test.login('aa110000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select (r.status = 'draft') as новий_заклад_чернетка_ожид_t
  from public.register_tenant('Студія Ірини', 'services', 'Полтава') r;
reset role;

-- Токен пересобираем: членство появилось после выдачи прошлого.
\set QUIET on
select test.login('aa110000-0000-0000-0000-000000000001');
\set QUIET off

\echo '--- 0016/0020: пока специальность не выбрана, синоним НЕ находит'
-- Проверка «до»: без неё следующая ничего не доказывает — магазин мог бы
-- находиться по названию, а не по синонимам справочника.
set role anon;
select count(*) as знайдено_по_синоніму_ожид_0
  from public.search_all('парикмахер') where title = 'Студія Ірини';
reset role;

\echo '--- 0016: витрина закрыта — поиск НЕ отдаёт заклад даже по его имени'
set role anon;
select count(*) as чернетка_у_пошуку_ожид_0 from public.search_all('Студія Ірини');
select count(*) as чернетка_на_карті_ожид_0 from public.map_tenants(null, 'Полтава');
reset role;

\echo '--- 0016: публикуем витрину обычным UPDATE под settings.write'
set role authenticated;
update public.tenants
   set status = 'active', storefront_enabled = true, listed_in_catalog = true,
       tagline = 'Стрижки і фарбування',
       speciality_id = (select id from public.specialities where slug = 'hair'),
       lat = 49.5883, lng = 34.5514,
       tax_id = '1234567890', legal_name = 'ФОП Ірина',
       contact_email = 'boss@studija.test', contact_phone = '+380671112233'
 where name = 'Студія Ірини';
reset role;

\echo '--- 0020: синоним справочника попал в поисковый вектор'
-- «парикмахер» нет ни в названии, ни в описании — слово живёт только
-- в specialities.synonyms у записи hair. Если триггер tenants_search_refresh
-- перестанет подмешивать синонимы, эта строка станет нулём.
set role anon;
select count(*) as знайдено_по_синоніму_ожид_1
  from public.search_all('парикмахер') where title = 'Студія Ірини';

\echo '--- 0016: триграммы добирают опечатку'
select count(*) as знайдено_з_опискою_ожид_1
  from public.search_all('студя ірини') where title = 'Студія Ірини';

\echo '--- 0016: фильтр города отсекает чужой'
select count(*) as чужий_город_ожид_0 from public.search_all('парикмахер', null, 'Львів');
select count(*) as свій_город_ожид_1  from public.search_all('парикмахер', null, 'Полтава');

\echo '--- 0016: черновик по слагу не находится и витриной не отдаётся'
-- «Салон Плетіння Кіс» завёл 05_compliance и не публиковал.
select count(*) as чернетка_у_пошуку_ожид_0 from public.search_all('Салон Плетіння');
select public.storefront(
         (select slug from public.tenants where name = 'Салон Плетіння Кіс')
       ) is null as чернетка_вітриною_ожид_t;

\echo '--- 0016: позиция закрытого магазина в поиск не попадает'
-- «Чуже пальто» лежит в «Магазин 2»: status = active, но storefront_enabled = f.
select count(*) as позиція_закритого_ожид_0
  from public.search_all('Чуже пальто') where title = 'Чуже пальто';

\echo '--- 0016: витрина не отдаёт ИНН, юрлицо и контакты владельца'
-- Слаг написан литералом намеренно: это публичный адрес витрины, и проверять
-- его надо тем же способом, каким его наберёт покупатель, а не подстановкой
-- из таблицы. До 0084 здесь стояло «studijeiryny» — сдвинутая таблица
-- транслитерации переводила пробел в букву «e», а «я» в «j».
select (public.storefront('studiya-iryny')->'shop') ? 'tax_id'        as инн_ожид_f,
       (public.storefront('studiya-iryny')->'shop') ? 'legal_name'    as юрлицо_ожид_f,
       (public.storefront('studiya-iryny')->'shop') ? 'contact_email' as почта_ожид_f,
       (public.storefront('studiya-iryny')->'shop') ? 'contact_phone' as телефон_ожид_f,
       (public.storefront('studiya-iryny')->'shop') ? 'search_tsv'    as вектор_ожид_f,
       (public.storefront('studiya-iryny')->'shop'->>'name')          as имя_ожид_студія;

\echo '--- 0016: карта отдаёт только опубликованных и только с координатами'
select count(*) as на_карті_полтава_ожид_1 from public.map_tenants(null, 'Полтава');
-- «Магазин 2» без координат и без витрины — его на карте быть не должно.
select count(*) as без_координат_на_карті_ожид_0
  from public.map_tenants() where name = 'Магазин 2';

\echo '--- 0016: p_limit зажат снизу — 0 не означает «отдать всё»'
select count(*) <= 1 as ліміт_нуль_не_відкриває_все_ожид_t
  from public.search_all('Магазин', null, null, 0);
reset role;

\echo '--- 0016: снятая витрина немедленно убирает заклад из всех четырёх точек'
-- Главная проверка набора. Продавец закрывает витрину — и обязан исчезнуть
-- из поиска, с карты и из списка городов. Если хоть одна функция помнит
-- прежнее состояние, неопубликованный заклад продолжает светиться наружу.
set role authenticated;
update public.tenants set storefront_enabled = false where name = 'Студія Ірини';
reset role;

set role anon;
select count(*) as у_пошуку_ожид_0   from public.search_all('парикмахер');
select count(*) as на_карті_ожид_0   from public.map_tenants(null, 'Полтава');
select count(*) as у_містах_ожид_0   from public.active_cities() where city = 'Полтава';
select public.storefront('studiya-iryny') is null as вітрина_ожид_t;
reset role;

\echo '--- 0016: возвращаем витрину — заклад появляется снова'
set role authenticated;
update public.tenants set storefront_enabled = true where name = 'Студія Ірини';
reset role;
set role anon;
select shops as магазинів_у_полтаві_ожид_1 from public.active_cities() where city = 'Полтава';
reset role;

\echo '--- 0020: справочник специальностей отдаёт только активные'
set role anon;
select count(*) as активних_ожид_понад_0 from public.specialities;
reset role;
-- Гасим одну и требуем, чтобы аноним её больше не видел: политика
-- specialities_read стоит на is_active, и это единственное, что её закрывает.
update public.specialities set is_active = false where slug = 'other';
set role anon;
select count(*) as погашена_видима_ожид_0 from public.specialities where slug = 'other';
reset role;
update public.specialities set is_active = true where slug = 'other';

\echo '--- 0020: аноним не правит справочник платформы'
set role anon;
do $$
begin
  insert into public.specialities (slug, name, kind)
  values ('hack', 'Своя спеціальність', 'service');
  raise exception 'ПРОВАЛ: анонім дописав довідник спеціальностей';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;
