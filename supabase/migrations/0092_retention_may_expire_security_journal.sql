-- ===========================================================================
-- 0092. Доделка 0091: срок хранения не мог примениться к журналу безопасности.
-- ===========================================================================
--
-- КАК НАШЛОСЬ. Проверкой исполнением, сразу после накатa 0091:
--   ERROR: журнал безпеки незмінний: DELETE заборонено
--   CONTEXT: security_events_immutable() ... retention_sweep(integer)
--
-- Тот же урок, что и в 0068: «применилось» не значит «работает». Первое же
-- правило ретенции падало о собственную защиту 0085, и без этой починки
-- функция не удаляла НИЧЕГО — ошибка роняла весь проход целиком.
--
-- ПОЧЕМУ ЩЕЛЬ, А НЕ СНЯТИЕ ЗАПРЕТА. Неизменяемость журнала безопасности —
-- это защита от подчистки следов задним числом, и она обязана остаться:
-- никакая роль, никакой сотрудник и никакой обход не должны уметь удалить
-- вчерашнюю строку о переборе пароля. Но «вечно» и «неизменяемо» — разные
-- свойства. В security_events лежат ip и user_agent, то есть персональные
-- данные, и держать их бессрочно — это и есть нарушение, которое закрывает
-- шаг 7. Разрешено ровно одно: удаление по сроку, из своей функции.
--
-- ПОЧЕМУ ЭТО НЕ ДЫРА. Форма щели повторяет уже существующую
-- (app.purging_account из 0058), и её свойства те же:
--   • флаг ставится через set_config(..., true) — то есть LOCAL, он живёт
--     внутри одной транзакции и наружу не вытекает;
--   • поставить его может только тот, кто уже исполняет код в базе;
--   • retention_sweep не принимает ни таблицы, ни условия параметром —
--     правила зашиты в её теле, произвольную строку ей не удалить;
--   • право на выполнение отобрано у public, anon и authenticated:
--     функцию зовёт расписание, а не пользователь;
--   • удаление ограничено сроком: строку моложе 90 дней не удаляет и она.
-- ===========================================================================

create or replace function public.security_events_immutable()
returns trigger
language plpgsql
set search_path to ''
as $fn$
begin
  -- Щель первая: удаление аккаунта (0058).
  if coalesce(current_setting('app.purging_account', true), 'off') = 'on'
     and tg_op = 'DELETE' then
    return old;
  end if;

  -- Щель вторая: срок хранения (0091). Только DELETE и только изнутри
  -- retention_sweep, которая ставит флаг локально в своей транзакции.
  if coalesce(current_setting('app.retention_sweep', true), 'off') = 'on'
     and tg_op = 'DELETE' then
    return old;
  end if;

  raise exception 'журнал безпеки незмінний: % заборонено', tg_op;
end;
$fn$;

comment on function public.security_events_immutable() is
  'Журнал безопасности не правится и не удаляется. Две названные щели: удаление аккаунта (0058) и срок хранения (0091), обе только на DELETE и обе локальные в своей транзакции.';

revoke all on function public.security_events_immutable() from public;

-- ── Сама очистка: флаг и устойчивость к отдельному отказавшему правилу ──────
--
-- Второе изменение против 0091: правило, упавшее по любой причине, больше
-- не роняет весь проход. Иначе одна новая защита на одной таблице снова
-- отменяет срок хранения на всех остальных, и узнать об этом можно будет
-- только из отсутствия записи о запуске.

create or replace function public.retention_sweep(p_batch integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_rule   record;
  v_sql    text;
  v_done   integer;
  v_total  integer;
  v_result jsonb := '{}'::jsonb;
  v_failed jsonb := '{}'::jsonb;
  v_pass   integer;
begin
  perform set_config('app.retention_sweep', 'on', true);

  for v_rule in
    select * from (values
      ('security_events',       'at < now() - interval ''90 days'''),
      ('notification_outbox',   'status in (''sent'',''failed'',''cancelled'') and created_at < now() - interval ''180 days'''),
      ('reminders',             'status in (''done'',''dismissed'') and created_at < now() - interval ''180 days'''),
      ('stock_reservations',    'status in (''released'',''expired'',''committed'') and created_at < now() - interval ''90 days'''),
      ('invitations',           'status in (''accepted'',''revoked'') and created_at < now() - interval ''90 days'''),
      ('import_jobs',           'status in (''done'',''failed'',''cancelled'') and created_at < now() - interval ''90 days'''),
      ('ai_jobs',               'status in (''done'',''failed'',''cancelled'') and created_at < now() - interval ''90 days'''),
      ('known_devices',         'last_seen < now() - interval ''365 days'''),
      ('integration_access_log','created_at < now() - interval ''365 days''')
    ) as r(tbl, cond)
  loop
    v_total := 0;
    v_pass  := 0;

    begin
      loop
        v_pass := v_pass + 1;

        v_sql := format(
          'delete from public.%I where ctid in (select ctid from public.%I where %s limit %s)',
          v_rule.tbl, v_rule.tbl, v_rule.cond, p_batch);

        execute v_sql;
        get diagnostics v_done = row_count;
        v_total := v_total + v_done;

        exit when v_done < p_batch or v_pass >= 20;
      end loop;
    exception when others then
      -- Правило упало — записываем причину и идём дальше. Тишина здесь
      -- означала бы, что срок хранения не работает и об этом никто не знает.
      v_failed := v_failed || jsonb_build_object(v_rule.tbl, sqlerrm);
    end;

    if v_total > 0 then
      v_result := v_result || jsonb_build_object(v_rule.tbl, v_total);
    end if;
  end loop;

  insert into public.security_events (kind, detail)
  values ('retention.sweep',
          jsonb_build_object('removed', v_result,
                             'failed', v_failed,
                             'batch', p_batch,
                             'empty', (v_result = '{}'::jsonb)));

  return jsonb_build_object('removed', v_result, 'failed', v_failed);
end;
$fn$;

comment on function public.retention_sweep(integer) is
  'Срок хранения служебных таблиц. Правила данными, удаление партиями, отказ одного правила не отменяет остальные. Санитарные журналы, аудит, первичный учёт и данные заведения не трогает никогда — список и причины в шапке 0091.';

revoke all on function public.retention_sweep(integer) from public;
revoke all on function public.retention_sweep(integer) from anon;
revoke all on function public.retention_sweep(integer) from authenticated;
