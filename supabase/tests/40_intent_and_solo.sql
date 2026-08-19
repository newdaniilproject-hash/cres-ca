-- 40. Признак регистрации (0118) и карточка мастера при создании заклада (0119).
--
-- Оба запрета проверяются ПОПЫТКОЙ их нарушить, а не наличием колонки
-- и функции: «колонка существует» показывало бы зелёное и при пустом
-- сторо́же.

\set ON_ERROR_STOP on
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off

\echo '=== 40. Ознака реєстрації та картка майстра ==='

-- Обратной засыпки («существующим строкам — seller») в этом прогоне нет
-- и быть не может: стенд накатывает миграции С НУЛЯ, и профили заводятся
-- уже после 0118, то есть триггером. Проверяем то, что от неё зависит
-- на бою: колонка обязательна и заполнена всегда.
\echo '--- признак заполнен у каждого профиля и допустимого значения'
do $$ declare n int; begin
  select count(*) into n from public.profiles
   where intent is null or intent not in ('buyer', 'seller');
  if n = 0 then raise notice 'ок: ознака заповнена в усіх профілях';
  else raise exception 'ПРОВАЛ: профілів без ознаки %', n; end if;
end $$;

\echo '--- ограничение отбивает значение вне списка даже у сервисной роли'
do $$ begin
  update public.profiles set intent = 'директор'
   where id = '11111111-1111-1111-1111-111111111111';
  raise exception 'ПРОВАЛ: чуже значення ознаки прийнято';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ок — %', sqlerrm;
end $$;

\echo '--- ГЛАВНОЕ: правка признака из кабинета отбита'
do $$ begin
  set local role authenticated;
  -- Именно на ПРОТИВОПОЛОЖНОЕ: сторож ловит `is distinct from`, и запись
  -- того же значения не должна считаться попыткой. В стенде профиль
  -- заводится триггером без метаданных, то есть 'buyer'; на бою у него
  -- 'seller' от обратной засыпки — поэтому значение считается, а не
  -- пишется буквой.
  update public.profiles
     set intent = case when intent = 'buyer' then 'seller' else 'buyer' end
   where id = '11111111-1111-1111-1111-111111111111';
  raise exception 'ПРОВАЛ: ознаку реєстрації переписали з кабінету';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ок — %', sqlerrm;
end $$;

\echo '--- чужое значение в метаданных не роняет регистрацию, а даёт buyer'
do $$ declare v text; begin
  insert into auth.users (id, email, raw_user_meta_data)
  values ('40000000-0000-0000-0000-000000000001', 'intent-junk@test.ua',
          jsonb_build_object('intent', 'директор'));
  select intent into v from public.profiles
   where id = '40000000-0000-0000-0000-000000000001';
  if v = 'buyer' then raise notice 'ок: невідоме значення стало buyer';
  else raise exception 'ПРОВАЛ: intent=%', coalesce(v, '<null>'); end if;
end $$;

\echo '--- признак из метаданных доезжает до профиля'
do $$ declare v text; begin
  insert into auth.users (id, email, raw_user_meta_data)
  values ('40000000-0000-0000-0000-000000000002', 'intent-buyer@test.ua',
          jsonb_build_object('intent', 'buyer'));
  select intent into v from public.profiles
   where id = '40000000-0000-0000-0000-000000000002';
  if v = 'buyer' then raise notice 'ок: buyer з метаданих';
  else raise exception 'ПРОВАЛ: intent=%', coalesce(v, '<null>'); end if;

  insert into auth.users (id, email, raw_user_meta_data)
  values ('40000000-0000-0000-0000-000000000003', 'intent-seller@test.ua',
          jsonb_build_object('intent', 'seller'));
  select intent into v from public.profiles
   where id = '40000000-0000-0000-0000-000000000003';
  if v = 'seller' then raise notice 'ок: seller з метаданих';
  else raise exception 'ПРОВАЛ: intent=%', coalesce(v, '<null>'); end if;
end $$;

\echo '--- согласия по-прежнему пишутся (тело handle_new_user перенесено целиком)'
do $$ declare n int; begin
  insert into auth.users (id, email, raw_user_meta_data)
  values ('40000000-0000-0000-0000-000000000004', 'intent-consent@test.ua',
          jsonb_build_object('intent', 'buyer', 'terms_version', '2026-08-01',
                             'signup_source', 'ios'));
  select count(*) into n from public.user_consents
   where user_id = '40000000-0000-0000-0000-000000000004';
  if n = 3 then raise notice 'ок: три згоди на місці';
  else raise exception 'ПРОВАЛ: згод %', n; end if;
end $$;

-- Заклады заводятся под ролью `authenticated` (иначе функция не пустит),
-- а СЧИТАЮТСЯ после сброса роли: политики staff и working_hours требуют
-- права из ТОКЕНА, а токен выдан до создания этих закладов и о них не
-- знает. Считать под authenticated значило бы проверять RLS, а не то,
-- завела ли функция карточку.
create temp table t40 (label text primary key, tenant_id uuid);
-- Временная таблица принадлежит роли прогона, а писать в неё будет
-- `authenticated`: без гранта блок падает на «permission denied».
grant insert, select on t40 to authenticated;

do $$ declare v_t uuid; begin
  set local role authenticated;
  select id into v_t from public.register_tenant('Салон Сорок', 'services', 'Київ');
  insert into t40 values ('services', v_t);
  select id into v_t from public.register_tenant('Крамниця Сорок', 'goods', 'Київ');
  insert into t40 values ('goods', v_t);
end $$;

\echo '--- ГЛАВНОЕ: заклад послуг получает карточку мастера и рабочую неделю'
do $$ declare v_t uuid; v_s int; v_h int; v_u uuid; begin
  select tenant_id into v_t from t40 where label = 'services';

  select count(*) into v_s from public.staff where tenant_id = v_t;
  if v_s <> 1 then raise exception 'ПРОВАЛ: карток майстра %', v_s; end if;

  select user_id into v_u from public.staff where tenant_id = v_t;
  if v_u is distinct from '11111111-1111-1111-1111-111111111111' then
    raise exception 'ПРОВАЛ: картка не привʼязана до власника';
  end if;

  select count(*) into v_h from public.working_hours where tenant_id = v_t;
  if v_h <> 5 then raise exception 'ПРОВАЛ: робочих днів %', v_h; end if;

  raise notice 'ок: картка майстра і пн–пт заведені';
end $$;

\echo '--- заклад товаров карточку НЕ получает'
do $$ declare v_t uuid; v_s int; begin
  select tenant_id into v_t from t40 where label = 'goods';
  select count(*) into v_s from public.staff where tenant_id = v_t;
  if v_s = 0 then raise notice 'ок: у товарного закладу майстрів немає';
  else raise exception 'ПРОВАЛ: карток %', v_s; end if;
end $$;

\echo '--- прежние проверки register_tenant не потеряны (короткое название)'
do $$ begin
  set local role authenticated;
  perform public.register_tenant('А', 'goods', 'Київ');
  raise exception 'ПРОВАЛ: заклад з однією літерою створився';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ок — %', sqlerrm;
end $$;

\echo '=== 40 пройдено ==='
