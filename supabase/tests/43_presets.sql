-- 43. Пресети (0122): заклад заводиться заповненим, а не порожнім.
--
-- Кожен запрет перевіряється ПОПИТКОЮ його порушити, а не наявністю
-- таблиці: «presets існує» показувало б зелене і при функції, що нічого
-- не розкладає.
--
-- ⚠️ Токен видається ДО створення закладу і про нього не знає, тому після
-- register_tenant обов'язковий повторний test.login — інакше tenant_can
-- не побачить права на щойно створений заклад. Це не милиця тесту, а те
-- саме, що в бою: права набувають чинності з оновленням токена.

\set ON_ERROR_STOP on

\echo '=== 43. Пресети ==='

-- Свій користувач, а не сидовий власник: у того вже три чернетки закладу
-- від попередніх наборів, і register_tenant його відіб'є. Тест, який
-- залежить від того, скільки закладів завів СУСІДНІЙ тест, ламається
-- у той день, коли сусід заведе ще один.
insert into auth.users (id, email, raw_user_meta_data)
values ('43000000-0000-0000-0000-000000000001', 'preset-owner@test.ua',
        jsonb_build_object('intent', 'seller', 'full_name', 'Пресет Власник'));

\set QUIET on
select test.login('43000000-0000-0000-0000-000000000001');
\set QUIET off

create temp table t43 (label text primary key, tenant_id uuid);
grant insert, select on t43 to authenticated;

do $$ declare v_t uuid; begin
  set local role authenticated;
  select id into v_t from public.register_tenant('Салон Сорок Три', 'services', 'Київ');
  insert into t43 values ('salon', v_t);
end $$;

-- Новий токен: тепер у ньому є щойно створений заклад.
\set QUIET on
select test.login('43000000-0000-0000-0000-000000000001');
\set QUIET off

\echo '--- пресет «Салон послуг» існує і має рядки'
do $$ declare n int; begin
  select count(*) into n from public.preset_items where preset_code = 'salon_services';
  if n >= 20 then raise notice 'ок: рядків у пресеті %', n;
  else raise exception 'ПРОВАЛ: рядків у пресеті лише %', n; end if;
end $$;

\echo '--- ГЛАВНОЕ: застосування розкладає довідники по закладу'
do $$ declare v_t uuid; v_res jsonb; n int; begin
  select tenant_id into v_t from t43 where label = 'salon';

  set local role authenticated;
  v_res := public.apply_preset(v_t, 'salon_services');
  reset role;

  select count(*) into n from public.storage_locations where tenant_id = v_t;
  if n < 3 then raise exception 'ПРОВАЛ: місць зберігання %', n; end if;

  select count(*) into n from public.cleaning_tasks where tenant_id = v_t;
  if n < 7 then raise exception 'ПРОВАЛ: пунктів прибирання %', n; end if;

  select count(*) into n from public.finance_categories where tenant_id = v_t;
  if n < 10 then raise exception 'ПРОВАЛ: категорій фінансів %', n; end if;

  select count(*) into n from public.tech_cards where tenant_id = v_t;
  if n < 1 then raise exception 'ПРОВАЛ: техкарт %', n; end if;

  raise notice 'ок: пресет розклався — %', v_res::text;
end $$;

\echo '--- поділ витрат на постійні і змінні доїхав'
do $$ declare v_t uuid; n int; begin
  select tenant_id into v_t from t43 where label = 'salon';
  select count(*) into n from public.finance_categories
   where tenant_id = v_t and kind = 'expense' and is_fixed;
  if n >= 4 then raise notice 'ок: постійних витрат %', n;
  else raise exception 'ПРОВАЛ: постійних витрат %', n; end if;
end $$;

\echo '--- ГЛАВНОЕ: повторне застосування нічого не подвоює'
do $$ declare v_t uuid; v_before int; v_after int; begin
  select tenant_id into v_t from t43 where label = 'salon';
  select count(*) into v_before from public.cleaning_tasks where tenant_id = v_t;

  set local role authenticated;
  perform public.apply_preset(v_t, 'salon_services');
  reset role;

  select count(*) into v_after from public.cleaning_tasks where tenant_id = v_t;
  if v_after = v_before then raise notice 'ок: повтор не подвоїв (% = %)', v_before, v_after;
  else raise exception 'ПРОВАЛ: було %, стало %', v_before, v_after; end if;
end $$;

\echo '--- неіснуючий пресет відбито'
do $$ declare v_t uuid; begin
  select tenant_id into v_t from t43 where label = 'salon';
  set local role authenticated;
  perform public.apply_preset(v_t, 'nema_takogo');
  raise exception 'ПРОВАЛ: неіснуючий пресет прийнято';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ок — %', sqlerrm;
end $$;

\echo '--- ГЛАВНОЕ: пресет НЕ додає закладу модулів'
do $$ declare v_t uuid; v_mods text[]; begin
  select tenant_id into v_t from t43 where label = 'salon';
  select modules::text[] into v_mods from public.tenants where id = v_t;
  -- Умолчание считает триггер из is_default (0110). Головне тут інше:
  -- застосування пресету вище не мало права цей набір розширити —
  -- інакше з'явився б шлях видати оплачений розділ повз оплату.
  if v_mods is null or array_length(v_mods, 1) is null then
    raise exception 'ПРОВАЛ: модулі закладу порожні';
  end if;
  if 'finance' = any(v_mods) and 'marketing' = any(v_mods) then
    raise exception 'ПРОВАЛ: пресет розширив набір модулів';
  end if;
  raise notice 'ок: модулів у закладу % — пресет їх не чіпав', array_length(v_mods, 1);
end $$;

\echo '=== 43 пройдено ==='
