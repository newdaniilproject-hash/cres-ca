-- 30_notification_proof.sql — подтверждение нотификации (миграция 0106).
--
-- ТЗ требует хранить доказательство нотификации от поставщика. Автоматической
-- проверки в реестре МОЗ не существует, значит вся ценность модуля в том,
-- что подтверждением НЕ МОЖЕТ стать что попало.
--
-- Пять обещаний, каждое отдельной попыткой:
--   1) документ своего засоба и вида notification принимается;
--   2) документ ДРУГОГО засоба — отказ (самая правдоподобная ошибка:
--      список документов заведения длинный, промахнуться легко);
--   3) документ другого ВИДА (msds) — отказ;
--   4) без права compliance.write — отказ;
--   5) снятие подтверждения гасит обе колонки разом.
--
-- Плюс: инспектор ВИДИТ состояние через compliance_materials, и отчёт
-- для проверки его печатает.
--
-- Файл самодостаточен и обёрнут в транзакцию с откатом.

\set ON_ERROR_STOP on

begin;

grant usage on schema public to anon, authenticated;

create schema if not exists test;
create or replace function test.login(p_user uuid) returns text
language sql as $$
  select set_config('request.jwt.claims',
    (public.custom_access_token_hook(
       jsonb_build_object('user_id', p_user,
                          'claims', jsonb_build_object('sub', p_user))
     ) -> 'claims')::text, false);
$$;

insert into auth.users (id, email) values
  ('27272727-0000-0000-0000-000000000001','moz-owner@test'),
  ('27272727-0000-0000-0000-000000000002','moz-master@test');

insert into public.tenants (id, slug, name, kind, status, storefront_enabled,
                            listed_in_catalog, city, modules)
values ('40270000-0000-0000-0000-000000000001','moz-shop','НОТИФІКАЦІЯ','both','active',
        true, true, 'ХАРКІВ', enum_range(null::public.tenant_module));

insert into public.tenant_members (tenant_id, user_id, role, permissions) values
  ('40270000-0000-0000-0000-000000000001','27272727-0000-0000-0000-000000000001','owner','{}'::jsonb),
  -- Мастер по ТЗ: журналы ведёт, карточку засоба не правит.
  ('40270000-0000-0000-0000-000000000001','27272727-0000-0000-0000-000000000002','operator',
   '{"compliance.read": true, "compliance.journal.write": true}'::jsonb);

insert into public.materials (id, tenant_id, name, unit, is_cosmetic, notification_code)
values ('4a700000-0000-0000-0000-000000000001','40270000-0000-0000-0000-000000000001',
        'КАНЕКАЛОН ЖОВТИЙ','шт', true, 'UA.TR.116.003-25'),
       ('4a700000-0000-0000-0000-000000000002','40270000-0000-0000-0000-000000000001',
        'ШАМПУНЬ','мл', true, null);

insert into public.material_documents (id, tenant_id, material_id, kind, title, path, uploaded_by)
values ('d0c00000-0000-0000-0000-000000000001','40270000-0000-0000-0000-000000000001',
        '4a700000-0000-0000-0000-000000000001','notification','Підтвердження від постачальника',
        '40270000-0000-0000-0000-000000000001/moz-1.pdf','27272727-0000-0000-0000-000000000001'),
       ('d0c00000-0000-0000-0000-000000000002','40270000-0000-0000-0000-000000000001',
        '4a700000-0000-0000-0000-000000000001','msds','MSDS',
        '40270000-0000-0000-0000-000000000001/msds-1.pdf','27272727-0000-0000-0000-000000000001'),
       -- Документ ЧУЖОГО засоба, но того же заведения и правильного вида.
       ('d0c00000-0000-0000-0000-000000000003','40270000-0000-0000-0000-000000000001',
        '4a700000-0000-0000-0000-000000000002','notification','Чуже підтвердження',
        '40270000-0000-0000-0000-000000000001/moz-2.pdf','27272727-0000-0000-0000-000000000001');

\set QUIET on
select test.login('27272727-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;

\echo '--- 0106: до подтверждения косметика помечена как без доказательства'
select notification_ok as підтверджено_ожид_f
  from public.compliance_materials
 where id = '4a700000-0000-0000-0000-000000000001';

\echo '--- 0106: свой документ вида notification принимается'
-- Функция ничего не возвращает: доказательство приёма — следующий запрос,
-- а не её результат. `is null` на void печатал бы `f` и читался как провал.
select public.confirm_notification(
  '4a700000-0000-0000-0000-000000000001','d0c00000-0000-0000-0000-000000000001');

select notification_ok as підтверджено_ожид_t,
       notification_confirmed_at is not null as дата_ожид_t
  from public.compliance_materials
 where id = '4a700000-0000-0000-0000-000000000001';

\echo '--- 0106: документ ЧУЖОГО засоба не принимается'
do $$
begin
  perform public.confirm_notification(
    '4a700000-0000-0000-0000-000000000001','d0c00000-0000-0000-0000-000000000003');
  raise exception 'ПРОВАЛ: підтвердженням став документ іншого засобу';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0106: документ другого ВИДА не принимается'
do $$
begin
  perform public.confirm_notification(
    '4a700000-0000-0000-0000-000000000001','d0c00000-0000-0000-0000-000000000002');
  raise exception 'ПРОВАЛ: підтвердженням став MSDS';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0106: отчёт для проверки печатает состояние нотификации'
select jsonb_array_length(
         public.compliance_report('40270000-0000-0000-0000-000000000001',
                                  current_date - 1, current_date) -> 'cosmetics'
       ) as засобів_у_звіті_ожид_2;

select (public.compliance_report('40270000-0000-0000-0000-000000000001',
                                 current_date - 1, current_date)
        -> 'cosmetics' -> 0 ->> 'ok') as перший_ожид_false;
-- Первым идёт НЕподтверждённый: порядок в отчёте `order by notification_ok`,
-- то есть проверка сразу видит проблемные позиции, а не ищет их глазами.

\echo '--- 0106: снятие подтверждения гасит обе колонки'
select public.revoke_notification('4a700000-0000-0000-0000-000000000001');
select notification_ok as підтверджено_ожид_f,
       notification_confirmed_at is null as дата_порожня_ожид_t
  from public.compliance_materials
 where id = '4a700000-0000-0000-0000-000000000001';

\echo '--- 0106: без права compliance.write подтверждение не ставится'
reset role;
\set QUIET on
select test.login('27272727-0000-0000-0000-000000000002');
\set QUIET off
set role authenticated;
do $$
begin
  perform public.confirm_notification(
    '4a700000-0000-0000-0000-000000000001','d0c00000-0000-0000-0000-000000000001');
  raise exception 'ПРОВАЛ: майстер підтвердив нотифікацію';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0106: но ВИДИТ состояние — он же ведёт журналы'
select count(*) as засобів_видно_ожид_2
  from public.compliance_materials
 where tenant_id = '40270000-0000-0000-0000-000000000001';

reset role;

\echo '--- 0106: функции анониму не открыты'
select has_function_privilege('anon','public.confirm_notification(uuid,uuid)','EXECUTE')
         as анонім_підтвердження_ожид_f,
       has_function_privilege('anon','public.revoke_notification(uuid)','EXECUTE')
         as анонім_зняття_ожид_f,
       has_function_privilege('authenticated','public.confirm_notification(uuid,uuid)','EXECUTE')
         as вошедший_ожид_t;

rollback;

\echo '--- 30_notification_proof: откат выполнен'
select count(*) as орендарів_ожид_0 from public.tenants
 where id = '40270000-0000-0000-0000-000000000001';
