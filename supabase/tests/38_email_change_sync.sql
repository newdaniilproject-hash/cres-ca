-- 38. Синхронизация почты после смены (0116).
-- Продолжает данные 01: владелец 1111 с профилем.

\set ON_ERROR_STOP on
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off

\echo '=== 38. Зміна пошти доходить до профілю ==='

\echo '--- ГЛАВНОЕ: подтверждённая смена в auth.users доезжает до profiles'
do $$ declare e text; begin
  -- Эмуляция того, что делает GoTrue после подтверждения обеих ссылок.
  update auth.users set email = 'owner-new-38@test.ua'
   where id = '11111111-1111-1111-1111-111111111111';
  select email into e from public.profiles
   where id = '11111111-1111-1111-1111-111111111111';
  if e = 'owner-new-38@test.ua' then raise notice 'ок: профіль синхронізовано';
  else raise exception 'ПРОВАЛ: у профілі %', e; end if;
end $$;

\echo '--- ГЛАВНОЕ: прямая правка profiles.email из кабинета отбита'
do $$ begin
  set local role authenticated;
  update public.profiles set email = 'hacker@test.ua'
   where id = '11111111-1111-1111-1111-111111111111';
  raise exception 'ПРОВАЛ: пряма правка пошти пройшла';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ок — %', sqlerrm;
end $$;

\echo '--- при этом имя и телефон правятся как раньше'
do $$ declare v text; begin
  update public.profiles
     set full_name = 'Оновлене Імʼя', phone = '+380501112238'
   where id = '11111111-1111-1111-1111-111111111111';
  select full_name into v from public.profiles
   where id = '11111111-1111-1111-1111-111111111111';
  if v = 'Оновлене Імʼя' then raise notice 'ок: імʼя і телефон правляться';
  else raise exception 'ПРОВАЛ: імʼя %', v; end if;
end $$;
