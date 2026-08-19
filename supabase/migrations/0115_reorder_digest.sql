-- 0115. «Пора замовити» — суточный дайджест, а не молчание.
--
-- ── Откуда ──────────────────────────────────────────────────────────────────
--
-- Долг назван в CLAUDE.md прямо: «„пора замовити" не ставит ничего…
-- либо собрать дайджест в базе, либо снять обещание». Экран
-- `/app/inventory/reorder` существует, но работает только на вытяжку:
-- о том, что перчатки кончаются, узнаёт тот, кто сам догадался зайти.
--
-- ── Почему ДАЙДЖЕСТ, а не письмо на позицию ─────────────────────────────────
--
-- Тот же урок, что у предупреждений о сроке (0014/0048): восемь одинаковых
-- писем утром перестают открывать. Здесь письмо ОДНО в сутки на человека:
-- список позиций одним текстом, сколько бы их ни было. Плейсхолдер {{items}}
-- собирается в базе строками с переносами — обработчик очереди превращает
-- переносы в абзацы (lib/email/queue.ts).
--
-- ── Правила, которые тут соблюдены ──────────────────────────────────────────
--
-- • Получатели — ровно по правилу 0048: владелец, точечное stock.read=true,
--   либо роль с stock.read без точечного запрета. Плюс `blocked_at is null` —
--   заблокированный сотрудник писем не получает (0048 писалась до блокировок).
-- • Ключ дедупликации содержит ДАТУ: повторный запуск в тот же день не шлёт
--   второе письмо, а завтрашний запуск честно шлёт новое.
-- • Триггеров нет: остаток меняется сотни раз в день, и дайджест по триггеру
--   стал бы спамом. Расписание — раз в сутки утром, тем же pg_cron, что
--   и предупреждения о сроке (0067).
-- • Если у заведения ничего не кончается — письма нет вовсе. Пустой дайджест
--   «у вас всё хорошо» — это обучение не открывать письма.

insert into public.notification_templates (tenant_id, event, channel, locale, subject, body) values
  (null, 'stock.reorder_digest', 'email', 'uk',
   'Пора замовити: {{count}}',
   'Закінчується або вже на межі:' || chr(10) || '{{items}}' || chr(10) ||
   'Повний список і кнопка «скопіювати для постачальника» — у розділі «Пора замовити».')
on conflict do nothing;

create or replace function public.reorder_digest_sweep()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant record;
  v_items  text;
  v_count  int;
  r        record;
  v_sent   int := 0;
begin
  for v_tenant in
    select distinct tenant_id from public.stock_low_view
  loop
    select count(*),
           string_agg(line, chr(10))
      into v_count, v_items
      from (
        -- FM-формат: без хвостовых нулей («2.5», а не «2.500»), но и без
        -- сюрприза trim-хака, который из «100» делал «1».
        select format('• %s — залишок %s %s, замовити %s %s',
                      title, to_char(stock_qty, 'FM999999990.###'),
                      coalesce(unit, ''),
                      to_char(to_order, 'FM999999990.###'),
                      coalesce(unit, '')) as line
          from public.stock_low_view
         where tenant_id = v_tenant.tenant_id
         order by to_order desc
         limit 12
      ) t;

    if v_count is null or v_count = 0 then
      continue;
    end if;
    if v_count = 12 then
      -- Возможно, позиций больше лимита — письмо говорит об этом честно,
      -- а точное число отдаёт экран.
      v_items := v_items || chr(10) || '…і це ще не все.';
    end if;

    for r in
      select tm.user_id, p.email
        from public.tenant_members tm
        join public.profiles p on p.id = tm.user_id
       where tm.tenant_id = v_tenant.tenant_id
         and tm.blocked_at is null
         and (
              tm.role = 'owner'
           or tm.permissions ->> 'stock.read' = 'true'
           or (
                exists (select 1 from public.role_grants rg
                         where rg.role = tm.role and rg.permission = 'stock.read')
                and coalesce(tm.permissions ->> 'stock.read', 'true') <> 'false'
              )
         )
    loop
      if r.email is not null then
        perform public.enqueue_notification(
          v_tenant.tenant_id, 'stock.reorder_digest', 'email',
          format('reorder:%s:%s:%s', v_tenant.tenant_id, current_date, r.user_id),
          jsonb_build_object(
            'count', v_count::text,
            'items', v_items),
          null, r.user_id, null, null, r.email);
        v_sent := v_sent + 1;
      end if;
    end loop;
  end loop;

  return v_sent;
end;
$$;

-- Зовёт планировщик под postgres; клиентским ролям выполнение ни к чему.
revoke execute on function public.reorder_digest_sweep() from public;
revoke execute on function public.reorder_digest_sweep() from anon;
revoke execute on function public.reorder_digest_sweep() from authenticated;

-- 05:30 UTC = утро в Украине; после ночных движений и до открытия смены.
select cron.schedule(
  'reorder-digest',
  '30 5 * * *',
  $$ select public.reorder_digest_sweep(); $$
);
