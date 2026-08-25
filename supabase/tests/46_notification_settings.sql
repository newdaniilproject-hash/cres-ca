-- 46. Налаштування сповіщень (0129).
--
-- Найдорожча відмова в цьому продукті — попередження про термін придатності,
-- яке перестало ходити. 0129 чіпає саме цей шлях, тому тут перевіряється
-- НЕ наявність таблиці, а поведінка черги при кожному значенні.
--
-- Головне, що доводить перший блок: заклад БЕЗ рядка налаштувань
-- поводиться рівно як до 0129. Якби це було не так, накат тихо вимкнув би
-- попередження всім закладам одразу.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('46000000-0000-0000-0000-000000000001', 'owner46@test'),
  ('46000000-0000-0000-0000-000000000002', 'master46@test');

insert into public.tenants (id, slug, name, status, kind)
values ('46000000-0000-0000-0000-0000000000aa', 'notif-shop', 'Сповіщення', 'active', 'services');

insert into public.profiles (id, email) values
  ('46000000-0000-0000-0000-000000000001', 'owner46@test'),
  ('46000000-0000-0000-0000-000000000002', 'master46@test')
on conflict (id) do update set email = excluded.email;

insert into public.tenant_members (tenant_id, user_id, role) values
  ('46000000-0000-0000-0000-0000000000aa', '46000000-0000-0000-0000-000000000001', 'owner'),
  ('46000000-0000-0000-0000-0000000000aa', '46000000-0000-0000-0000-000000000002', 'operator');

\echo '--- 0129: без рядка налаштувань поведінка ТА САМА, що до міграції'
do $$
declare v_n int;
begin
  delete from public.notification_outbox
   where tenant_id = '46000000-0000-0000-0000-0000000000aa';

  perform public.enqueue_expiry_for(
    '46000000-0000-0000-0000-0000000000aa', 'container',
    '46000000-0000-0000-0000-0000000000b1', 'CR-1', 'Спрей',
    (current_date + 30)::date);

  select count(*) into v_n from public.notification_outbox
   where tenant_id = '46000000-0000-0000-0000-0000000000aa';

  -- Двоє отримувачів (власник і майстер зі `stock.read`) × два строки
  -- (14 і 7) × два канали = вісім.
  if v_n <> 8 then
    raise exception 'ПРОВАЛ: очікували 8 рядків без налаштувань, маємо %', v_n;
  end if;
  raise notice 'ok — умовчання не змінює поведінку: % рядків', v_n;
end;
$$;

\echo '--- 0129: вимкнений push лишає тільки листи'
do $$
declare v_push int; v_mail int;
begin
  delete from public.notification_outbox
   where tenant_id = '46000000-0000-0000-0000-0000000000aa';
  insert into public.notification_settings (tenant_id, expiry_push)
  values ('46000000-0000-0000-0000-0000000000aa', false)
  on conflict (tenant_id) do update set expiry_push = false;

  perform public.enqueue_expiry_for(
    '46000000-0000-0000-0000-0000000000aa', 'container',
    '46000000-0000-0000-0000-0000000000b2', 'CR-2', 'Спрей',
    (current_date + 30)::date);

  select count(*) filter (where channel = 'push'),
         count(*) filter (where channel = 'email')
    into v_push, v_mail
    from public.notification_outbox
   where tenant_id = '46000000-0000-0000-0000-0000000000aa';

  if v_push <> 0 then raise exception 'ПРОВАЛ: push пішов при вимкненому каналі (%)', v_push; end if;
  if v_mail <> 4 then raise exception 'ПРОВАЛ: очікували 4 листи, маємо %', v_mail; end if;
  raise notice 'ok — push вимкнено, листи ходять';
end;
$$;

\echo '--- 0129: owner_only лишає лише власника'
do $$
declare v_n int; v_others int;
begin
  delete from public.notification_outbox
   where tenant_id = '46000000-0000-0000-0000-0000000000aa';
  update public.notification_settings
     set expiry_push = true, expiry_recipients = 'owner_only'
   where tenant_id = '46000000-0000-0000-0000-0000000000aa';

  perform public.enqueue_expiry_for(
    '46000000-0000-0000-0000-0000000000aa', 'container',
    '46000000-0000-0000-0000-0000000000b3', 'CR-3', 'Спрей',
    (current_date + 30)::date);

  select count(*),
         count(*) filter (where user_id <> '46000000-0000-0000-0000-000000000001')
    into v_n, v_others
    from public.notification_outbox
   where tenant_id = '46000000-0000-0000-0000-0000000000aa';

  if v_others <> 0 then
    raise exception 'ПРОВАЛ: при owner_only сповіщення пішло не власнику (%)', v_others;
  end if;
  if v_n <> 4 then raise exception 'ПРОВАЛ: очікували 4 рядки власнику, маємо %', v_n; end if;
  raise notice 'ok — owner_only: тільки власник';
end;
$$;

\echo '--- 0129: обидва канали вимкнені — черга порожня'
do $$
declare v_n int;
begin
  delete from public.notification_outbox
   where tenant_id = '46000000-0000-0000-0000-0000000000aa';
  update public.notification_settings
     set expiry_email = false, expiry_push = false, expiry_recipients = 'stock_read'
   where tenant_id = '46000000-0000-0000-0000-0000000000aa';

  perform public.enqueue_expiry_for(
    '46000000-0000-0000-0000-0000000000aa', 'container',
    '46000000-0000-0000-0000-0000000000b4', 'CR-4', 'Спрей',
    (current_date + 30)::date);

  select count(*) into v_n from public.notification_outbox
   where tenant_id = '46000000-0000-0000-0000-0000000000aa';
  if v_n <> 0 then raise exception 'ПРОВАЛ: черга не порожня при вимкнених каналах (%)', v_n; end if;
  raise notice 'ok — обидва канали вимкнені, нічого не поставлено';
end;
$$;

\echo '--- 0129: порогів 14/7 у налаштуваннях НЕМАЄ і не має зʼявитись'
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'notification_settings'
                and column_name in ('expiry_days_first', 'expiry_days_second',
                                    'days_before', 'expiry_days')) then
    raise exception 'ПРОВАЛ: пороги винесені в налаштування — це вимога ТЗ, а не смак закладу';
  end if;
  raise notice 'ok — пороги лишились кодом';
end;
$$;

rollback;
