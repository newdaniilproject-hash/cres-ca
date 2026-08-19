-- 37. Дайджест «пора замовити» (0115).
-- Продолжает данные 01/34: заведение aaaa…01, владелец 1111,
-- оператор 2222 (роль без stock.write, но stock.read у operator есть).

\set ON_ERROR_STOP on
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off

\echo '=== 37. Дайджест «пора замовити» ==='

\set QUIET on
-- Материал у порога: остаток 2, порог 5 → в списке закупки.
insert into public.materials (id, tenant_id, name, unit, min_stock_threshold)
values ('37000000-0000-0000-0000-0000000000aa',
        'aaaaaaaa-0000-0000-0000-000000000001', 'Рукавички 37', 'пара', 5);
select public.record_stock_movement(
  'aaaaaaaa-0000-0000-0000-000000000001', 'receipt', 2,
  null, '37000000-0000-0000-0000-0000000000aa');
\set QUIET off

\echo '--- письмо ставится в очередь: одно на получателя, список внутри'
do $$ declare n int; body jsonb; begin
  perform public.reorder_digest_sweep();
  select count(*) into n from public.notification_outbox
   where event = 'stock.reorder_digest'
     and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if n < 1 then raise exception 'ПРОВАЛ: дайджест не поставлено (%)', n; end if;

  select payload into body from public.notification_outbox
   where event = 'stock.reorder_digest' limit 1;
  if body ->> 'items' like '%Рукавички 37%' then
    raise notice 'ок: дайджест у черзі (%), позиція в списку', n;
  else raise exception 'ПРОВАЛ: у payload немає позиції: %', body; end if;
end $$;

\echo '--- ГЛАВНОЕ: повторный запуск в тот же день второго письма не ставит'
do $$ declare n1 int; n2 int; begin
  select count(*) into n1 from public.notification_outbox
   where event = 'stock.reorder_digest';
  perform public.reorder_digest_sweep();
  select count(*) into n2 from public.notification_outbox
   where event = 'stock.reorder_digest';
  if n1 = n2 then raise notice 'ок: дедуплікація за днем працює';
  else raise exception 'ПРОВАЛ: було %, стало %', n1, n2; end if;
end $$;

\echo '--- пополнение выше порога: завтра письма не будет (список пуст)'
do $$ declare n int; begin
  perform public.record_stock_movement(
    'aaaaaaaa-0000-0000-0000-000000000001', 'receipt', 100,
    null, '37000000-0000-0000-0000-0000000000aa');
  select count(*) into n from public.stock_low_view
   where id = '37000000-0000-0000-0000-0000000000aa';
  if n = 0 then raise notice 'ок: позиція зникла зі списку закупівлі';
  else raise exception 'ПРОВАЛ: позиція досі в списку'; end if;
end $$;
