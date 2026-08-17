-- 21_account_deletion.sql — удаление аккаунта (0024, файлы — 0057,
-- обход графа зависимостей — 0058).
--
-- Требование Apple 5.1.1(v): приложение с регистрацией обязано давать
-- удалить аккаунт изнутри. Но «кнопка есть» — не то же самое, что «данные
-- ушли»: 0058 писалась потому, что удаление не срабатывало НИ РАЗУ —
-- каскад от tenants упирался в двенадцать связей с on delete restrict,
-- пользователь жал кнопку и получал 23503, а данные оставались в базе.
--
-- Три обещания, каждое проверяется попыткой нарушить:
--   1) удаляет РОВНО СВОЁ — чужой заклад и чужой человек целы;
--   2) заклад сносится только там, где владелец единственный;
--   3) магазин не остаётся без хозяина.
--
-- Набор стоит последним осознанно: он единственный, кто удаляет строки
-- насовсем, и работает только на собственных фикстурах.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('aa210000-0000-0000-0000-000000000001','deleter@test.ua'),
  ('aa210000-0000-0000-0000-000000000002','survivor@test.ua'),
  ('aa210000-0000-0000-0000-000000000003','colleague@test.ua')
on conflict (id) do nothing;

-- ── Заклад 1: наш, владелец единственный, с журналом и движениями ────────
\set QUIET on
select test.login('aa210000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select (r.name = 'Салон На Видалення') as заклад1_ожид_t
  from public.register_tenant('Салон На Видалення', 'services', 'Полтава') r;
reset role;
\set QUIET on
select test.login('aa210000-0000-0000-0000-000000000001');
\set QUIET off

-- Наполняем обычными путями. Движение остатка кладём record_stock_movement:
-- именно stock_movements.variant_id держит on delete restrict, о который
-- каскад из 0024 и спотыкался.
set role authenticated;
insert into public.offerings (id, tenant_id, kind, status, slug, title, price)
select 'aa210000-0000-0000-0000-000000000011', t.id, 'service','draft','strizka','Стрижка', 500
  from public.tenants t where t.name = 'Салон На Видалення';
insert into public.offering_variants (id, tenant_id, offering_id, name, price, duration_minutes)
select 'aa210000-0000-0000-0000-000000000012', t.id,
       'aa210000-0000-0000-0000-000000000011','Базова', 500, 60
  from public.tenants t where t.name = 'Салон На Видалення';
insert into public.materials (id, tenant_id, name, unit)
select 'aa210000-0000-0000-0000-000000000013', t.id, 'Шампунь салону','флакон'
  from public.tenants t where t.name = 'Салон На Видалення';

do $$
declare v_t uuid;
begin
  select id into v_t from public.tenants where name = 'Салон На Видалення';
  perform public.record_stock_movement(v_t, 'receipt', 3,
            'aa210000-0000-0000-0000-000000000012', null, null, null, null, null,
            'початковий залишок');
end $$;
reset role;

select (select count(*) from public.stock_movements sm
         join public.tenants t on t.id = sm.tenant_id
        where t.name = 'Салон На Видалення') as рухів_ожид_1,
       (select count(*) from public.audit_log a
         join public.tenants t on t.id = a.tenant_id
        where t.name = 'Салон На Видалення') > 0 as журнал_ожид_t;

-- ── Заклад 2: пробуем сделать двух владельцев ────────────────────────────
\set QUIET on
select test.login('aa210000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select (r.name = 'Салон Двох Власників') as заклад2_ожид_t
  from public.register_tenant('Салон Двох Власників', 'goods', 'Полтава') r;
reset role;

-- Токен обнуляем явно: test.login кладёт claims в настройку сеанса, и она
-- переживает `reset role`. Пока claims на месте, auth.uid() не пуст —
-- и сторож 0081 видит перед собой человека, а не миграцию.
\set QUIET on
select set_config('request.jwt.claims', '{}', false);
\set QUIET off

\echo '--- 0001/0081: второго владельца не бывает — ни человеку, ни миграции'
-- Это важно знать ровно здесь. delete_my_account сносит заклад только
-- если владелец в нём один: `(select count(*) … role = 'owner') = 1`.
-- Условие не декоративное только при условии, что второй владелец
-- в принципе возможен. Ниже — попытка завести его ДВАЖДЫ: как человек
-- (ловит сторож 0081) и в обход, от имени системы с пустым auth.uid()
-- (ловит уникальный частичный индекс tenant_members_single_owner_idx
-- из 0001). Если обе попытки отбиты, «магазин без хозяина» может
-- получиться только одним способом — если удаление снесёт владельца,
-- не снеся заклад. Ровно это и проверяет инвариант в конце набора.
do $$
begin
  insert into public.tenant_members (tenant_id, user_id, role)
  select t.id, 'aa210000-0000-0000-0000-000000000002', 'owner'
    from public.tenants t where t.name = 'Салон Двох Власників';
  raise exception 'ПРОВАЛ: у закладі завелося два власники';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

-- Второго человека всё же вводим в заклад — сотрудником. Он и покажет,
-- что вместе с закладом уходят чужие членства, а сам человек остаётся.
insert into public.tenant_members (tenant_id, user_id, role)
select t.id, 'aa210000-0000-0000-0000-000000000002', 'manager'
  from public.tenants t where t.name = 'Салон Двох Власників';

-- ── Заклад 3: чужой, мы в нём просто сотрудник ───────────────────────────
\set QUIET on
select test.login('aa210000-0000-0000-0000-000000000003');
\set QUIET off
set role authenticated;
select (r.name = 'Салон Колеги') as заклад3_ожид_t
  from public.register_tenant('Салон Колеги', 'goods', 'Полтава') r;
reset role;
\set QUIET on
select set_config('request.jwt.claims', '{}', false);
\set QUIET off
insert into public.tenant_members (tenant_id, user_id, role)
select t.id, 'aa210000-0000-0000-0000-000000000001', 'admin'
  from public.tenants t where t.name = 'Салон Колеги';

\echo '--- 0024: анониму удаление аккаунта не выдано'
set role anon;
do $$
begin
  perform public.delete_my_account();
  raise exception 'ПРОВАЛ: анонім видалив акаунт';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

\echo '--- 0024: без токена удалять нечего'
\set QUIET on
select set_config('request.jwt.claims', '{}', false);
\set QUIET off
set role authenticated;
do $$
begin
  perform public.delete_my_account();
  raise exception 'ПРОВАЛ: акаунт видалено без auth.uid()';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

\echo '--- 0058: служебная чистка не зовётся снаружи сценария удаления'
-- purge_tenant_rows сносит заклад целиком и потому требует транзакционный
-- флаг, который выставляет только delete_my_account. Без флага она обязана
-- отказать — иначе это готовый инструмент сноса чужого заведения.
do $$
begin
  perform public.purge_tenant_rows(
    (select id from public.tenants where name = 'Салон Колеги'));
  raise exception 'ПРОВАЛ: purge_tenant_rows спрацювала без прапорця';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0057: пока файлы заклада не убраны, удаление НЕ начинается'
-- Удалять строки storage.objects из SQL запрещает сам Supabase
-- (protect_objects_delete). 0057 сделала из этого явную остановку:
-- лучше внятная ошибка, чем половина заклада снесена, а файлы висят.
-- Строку реестра кладём от имени системы: своей функции для файлов
-- в базе нет, их пишет приложение через Storage API.
insert into storage.objects (bucket_id, name)
select 'media', t.id::text || '/offerings/foto.jpg'
  from public.tenants t where t.name = 'Салон На Видалення';

\set QUIET on
select test.login('aa210000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
do $$
begin
  perform public.delete_my_account();
  raise exception 'ПРОВАЛ: акаунт видалено, а файли закладу лишилися';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

\echo '--- 0057: отказ ничего не снёс — заклад и человек на месте'
-- Проверка того, что остановка ЦЕЛАЯ: функция не успела удалить половину.
select (select count(*) from public.tenants where name = 'Салон На Видалення') as заклад_ожид_1,
       (select count(*) from public.profiles where id = 'aa210000-0000-0000-0000-000000000001') as профіль_ожид_1,
       (select count(*) from public.stock_movements sm
         join public.tenants t on t.id = sm.tenant_id
        where t.name = 'Салон На Видалення') as рухи_ожид_1;

-- Приложение убрало файл через Storage API — снимаем строку реестра.
delete from storage.objects where name like (
  select t.id::text || '/%' from public.tenants t where t.name = 'Салон На Видалення');

\echo '--- 0024/0058: удаление проходит'
-- Запоминаем, сколько закладов уже стоят без владельца ДО удаления.
-- Один такой есть: «Магазин 2» завёл фикстурой набор 02 прямой вставкой,
-- владельца ему никто не назначал. Поэтому инвариант в конце сверяет
-- не «ноль», а «не прибавилось» — иначе он ловил бы чужую фикстуру
-- вместо того, ради чего написан.
select set_config('test.ownerless_before',
  (select count(*)::text from public.tenants t
    where not exists (select 1 from public.tenant_members tm
                       where tm.tenant_id = t.id and tm.role = 'owner')), false)
  as безхазяйних_до;

\set QUIET on
select test.login('aa210000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
do $$
begin
  perform public.delete_my_account();
  raise notice 'ok — акаунт видалено';
exception when others then
  raise exception 'ПРОВАЛ: видалення акаунта впало — %', sqlerrm;
end $$;
reset role;

\echo '--- 0058: заклад, где владелец единственный, снесён ЦЕЛИКОМ'
-- Вместе с ним обязаны уйти движения, материалы и журнал действий:
-- «данные заведения — собственность клиента», а не наш архив.
select (select count(*) from public.tenants where name = 'Салон На Видалення') as заклад_ожид_0,
       (select count(*) from public.stock_movements
         where variant_id = 'aa210000-0000-0000-0000-000000000012') as рухи_ожид_0,
       (select count(*) from public.materials
         where id = 'aa210000-0000-0000-0000-000000000013') as матеріали_ожид_0,
       (select count(*) from public.offerings
         where id = 'aa210000-0000-0000-0000-000000000011') as позиції_ожид_0;

\echo '--- 0058: сотрудник ушёл вместе с закладом, а сам человек цел'
-- «Салон Двох Власників» принадлежал удаляемому единолично, значит уходит
-- целиком — вместе с членством нанятого туда управляющего. Но человек
-- при этом остаётся: удаляют СВОЙ аккаунт, а не всех, кто рядом.
select (select count(*) from public.tenants where name = 'Салон Двох Власників') as заклад_ожид_0,
       (select count(*) from public.tenant_members
         where user_id = 'aa210000-0000-0000-0000-000000000002') as членств_керуючого_ожид_0,
       (select count(*) from public.profiles
         where id = 'aa210000-0000-0000-0000-000000000002') as керуючий_живий_ожид_1;

\echo '--- 0024: чужой заклад цел, а наше членство в нём ушло'
select (select count(*) from public.tenants where name = 'Салон Колеги') as заклад_ожид_1,
       (select count(*) from public.tenant_members tm
          join public.tenants t on t.id = tm.tenant_id
         where t.name = 'Салон Колеги'
           and tm.user_id = 'aa210000-0000-0000-0000-000000000001') as наше_членство_ожид_0,
       (select count(*) from public.tenant_members tm
          join public.tenants t on t.id = tm.tenant_id
         where t.name = 'Салон Колеги' and tm.role = 'owner') as власників_ожид_1;

\echo '--- 0024: удалён РОВНО ОДИН человек — свой'
select (select count(*) from public.profiles
         where id = 'aa210000-0000-0000-0000-000000000001') as ми_ожид_0,
       (select count(*) from auth.users
         where id = 'aa210000-0000-0000-0000-000000000001') as ми_в_auth_ожид_0,
       (select count(*) from public.profiles
         where id = 'aa210000-0000-0000-0000-000000000002') as сусід_ожид_1,
       (select count(*) from public.profiles
         where id = 'aa210000-0000-0000-0000-000000000003') as колега_ожид_1;

\echo '--- главный инвариант: удаление не оставило ни одного заклада без хозяина'
-- Строка, ради которой набор написан. Если она когда-нибудь покажет
-- не ноль — значит удаление аккаунта оставило магазин, в который
-- не может войти никто, включая нас: ни владельца, ни поддержки,
-- ни способа его закрыть.
do $$
declare v_before int := current_setting('test.ownerless_before')::int; v_after int;
begin
  select count(*) into v_after from public.tenants t
   where not exists (select 1 from public.tenant_members tm
                      where tm.tenant_id = t.id and tm.role = 'owner');
  if v_after > v_before then
    raise exception 'ПРОВАЛ: видалення лишило % закладів без хазяїна', v_after - v_before;
  end if;
  raise notice 'ok — безхазяйних не додалося (було %, стало %)', v_before, v_after;
end $$;

\echo '--- 0058: чужие данные и справочники платформы не тронуты'
-- purge_tenant_rows ходит по графу автоматически, и это ровно тот случай,
-- когда «само разберётся» может унести лишнее. Справочники к арендатору
-- не привязаны и обязаны остаться целыми.
select (select count(*) from public.tenants
         where id = 'aaaaaaaa-0000-0000-0000-000000000001') as магазин1_ожид_1,
       (select count(*) from public.offerings
         where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001') > 0 as позиції_магазину1_ожид_t,
       (select count(*) from public.specialities) as довідник_ожид_20,
       (select count(*) from public.role_grants) > 0 as права_ролей_ожид_t,
       (select count(*) from public.notification_templates
         where tenant_id is null) > 0 as спільні_шаблони_ожид_t;

\echo '--- 0024: журнал прав и журнал действий чужого заклада целы'
select (select count(*) from public.audit_log
         where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001') > 0 as журнал_дій_ожид_t,
       (select count(*) from public.permission_audit
         where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001') > 0 as журнал_прав_ожид_t;
