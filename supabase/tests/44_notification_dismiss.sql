-- 44. Очищення черги сповіщень (0125).
--
-- Кожен запрет перевіряється ПОПИТКОЮ його порушити, а не наявністю
-- функції: «dismiss_notifications існує» показувало б зелене і в тому
-- випадку, коли вона гасить майбутні нагадування або пускає будь-кого.
--
-- Три речі, які тут можуть зламатися мовчки:
--   1. право (гасити може той, кому дозволено читати — а не той, кому
--      дозволено налаштовувати);
--   2. МАЙБУТНІ нагадування (клієнту за 24 і за 2 години до запису) —
--      їх погасити не можна, інакше екран стає чистішим, а людина
--      не приходить на процедуру;
--   3. чуже заклад — ідентифікатор приходить із клієнта.

\set ON_ERROR_STOP on

\echo '=== 44. Очищення черги сповіщень ==='

-- Три рядки в черзі одного закладу: два прострочені, один майбутній.
insert into public.notification_outbox
  (tenant_id, event, channel, payload, send_after, dedupe_key)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'expiry.warning', 'email',
   '{}'::jsonb, now() - interval '3 days', 'test44:overdue:1'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'expiry.warning', 'email',
   '{}'::jsonb, now() - interval '1 hour', 'test44:overdue:2'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'booking.reminder', 'email',
   '{}'::jsonb, now() + interval '2 days', 'test44:future:1');

\echo '--- 0125: без settings.write очистити не можна'
-- Оператор має stock.read і orders.*, але не налаштування закладу.
\set QUIET on
select test.login('22222222-2222-2222-2222-222222222222');
\set QUIET off
do $$
begin
  set local role authenticated;
  perform public.dismiss_notifications('aaaaaaaa-0000-0000-0000-000000000001');
  raise exception 'ПРОВАЛ: оператор погасив чергу без settings.write';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0125: власник гасить ТІЛЬКИ прострочені'
-- Перевіряється СТАН конкретних рядків, а не повернуте число: у цьому
-- закладі до нас уже нагромадили черги сусідні набори, і тест, що
-- звіряє загальний лічильник, ламається в той день, коли сусід поставить
-- ще одне нагадування.
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
do $$
declare v_n integer;
begin
  set local role authenticated;
  select public.dismiss_notifications('aaaaaaaa-0000-0000-0000-000000000001') into v_n;
  if v_n < 2 then
    raise exception 'ПРОВАЛ: погашено % рядків, а прострочених було щонайменше два', v_n;
  end if;
  raise notice 'ok — прострочені погашено (%)', v_n;
end $$;

\echo '--- 0125: майбутнє нагадування лишилось у черзі'
do $$
declare v_status text;
begin
  select status into v_status
    from public.notification_outbox
   where dedupe_key = 'test44:future:1';
  if v_status is distinct from 'pending' then
    raise exception 'ПРОВАЛ: майбутнє нагадування погашено (статус %)', v_status;
  end if;
  raise notice 'ok — майбутнє нагадування недоторкане';
end $$;

\echo '--- 0125: рядки не видалені, а скасовані (черга — ще й журнал)'
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from public.notification_outbox
   where dedupe_key in ('test44:overdue:1', 'test44:overdue:2')
     and status = 'cancelled';
  if v_n <> 2 then
    raise exception 'ПРОВАЛ: скасованих рядків %, а не 2', v_n;
  end if;
  raise notice 'ok — рядки лишились у таблиці зі статусом cancelled';
end $$;

\echo '--- 0125: повторний прохід нічого не знаходить'
do $$
declare v_n integer;
begin
  set local role authenticated;
  select public.dismiss_notifications('aaaaaaaa-0000-0000-0000-000000000001') into v_n;
  if v_n <> 0 then
    raise exception 'ПРОВАЛ: повторний прохід погасив % рядків', v_n;
  end if;
  raise notice 'ok — повторний прохід порожній';
end $$;

\echo '--- 0125: скасований рядок ВОСКРЕСАЄ при повторній постановці (0047)'
-- Це і робить очищення безпечним: прибрали з очей — знадобиться,
-- повернеться саме, а не загубиться назавжди.
do $$
declare v_status text;
begin
  perform public.enqueue_notification(
    'aaaaaaaa-0000-0000-0000-000000000001', 'expiry.warning', 'email',
    'test44:overdue:1', '{}'::jsonb, now());
  select status into v_status
    from public.notification_outbox where dedupe_key = 'test44:overdue:1';
  if v_status is distinct from 'pending' then
    raise exception 'ПРОВАЛ: скасований рядок не воскрес (статус %)', v_status;
  end if;
  raise notice 'ok — скасований рядок повернувся в чергу';
end $$;

\echo '--- 0125: чужий заклад погасити не можна'
do $$
begin
  set local role authenticated;
  perform public.dismiss_notifications('aaaaaaaa-0000-0000-0000-000000000002');
  raise exception 'ПРОВАЛ: погашено чергу чужого закладу';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;
