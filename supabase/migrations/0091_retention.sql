-- ===========================================================================
-- 0091. Шаг 7, пункт В: срок хранения. Служебные таблицы.
-- ===========================================================================
--
-- ЧТО БЫЛО. Ни одного задания очистки: pg_cron держал notifications-dispatch,
-- expiry-rescan и rate-counters-sweep, и ни одного правила ретенции.
-- Всё, что записано, лежит вечно — включая таблицы, которые ХРАНЯТ КОНТАКТЫ
-- ПОКУПАТЕЛЯ по служебной надобности:
--   notification_outbox.to_phone и to_email — телефон и почта в каждой строке;
--   security_events.ip и user_agent — адрес и устройство человека;
--   known_devices.last_ip — то же самое.
-- Хранить дольше, чем нужно для работы, — это не «запас», а увеличение
-- ущерба от любой будущей утечки ровно на объём этого запаса.
--
-- ЧТО СТАЛО. Одна функция, один список правил, одно задание в сутки.
--
-- ЧЕГО ЭТА ФУНКЦИЯ НЕ ТРОГАЕТ НИКОГДА — и это главная её часть:
--   cleaning_entries, sanitation_solutions, sterilization_cycles — санитарные
--     журналы. Их спрашивает Держпродспоживслужба, и они неизменяемы
--     по устройству. Удалить их значит снести доказательство соответствия;
--   audit_log и permission_audit — журналы действий и прав. Они и есть ответ
--     на вопрос «кто это сделал», в том числе про саму утечку;
--   tech_cards, material_batches, material_containers — реестр и сроки;
--   stock_movements и finance_records — первичный учёт;
--   customers, orders, bookings — данные заведения, а не наши. Срок по ним
--     считается отдельно (обезличивание вместо удаления) и назначается
--     владельцем, а не платформой.
--
-- ПОЧЕМУ ПАРТИЯМИ. Одна транзакция на полмиллиона строк держит блокировку
-- и останавливает работу мастера. Каждое правило удаляет не больше
-- p_batch строк за проход и не больше 20 проходов за запуск; остаток уйдёт
-- завтра. Задание идёт ночью, но «ночью» не значит «никто не работает».
--
-- ПОЧЕМУ ЗАПИСЬ О ЗАПУСКЕ ОБЯЗАТЕЛЬНА. Молчаливое задание, удаляющее данные,
-- невозможно объяснить клиенту и невозможно отличить от сбоя. Итог каждого
-- запуска ложится в security_events отдельным видом события.
-- ===========================================================================

-- ── 1. Новый вид события для журнала безопасности ───────────────────────────

alter table public.security_events drop constraint if exists security_events_kind_check;
alter table public.security_events add constraint security_events_kind_check
  check (kind in ('login.failed','login.locked','login.new_device',
                  'tenant.foreign_access','record.immutable_attempt',
                  'retention.sweep'));

-- ── 2. Сама очистка ─────────────────────────────────────────────────────────

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
  v_pass   integer;
begin
  -- Правила лежат данными, а не двадцатью кусками кода: добавить срок
  -- хранения новой таблице должно быть одной строкой, а не новой функцией.
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

    if v_total > 0 then
      v_result := v_result || jsonb_build_object(v_rule.tbl, v_total);
    end if;
  end loop;

  insert into public.security_events (kind, detail)
  values ('retention.sweep',
          jsonb_build_object('removed', v_result,
                             'batch', p_batch,
                             'empty', (v_result = '{}'::jsonb)));

  return v_result;
end;
$fn$;

comment on function public.retention_sweep(integer) is
  'Срок хранения служебных таблиц. Санитарные журналы, аудит, первичный учёт и данные заведения не трогает никогда — список и причины в шапке 0091.';

revoke all on function public.retention_sweep(integer) from public;
revoke all on function public.retention_sweep(integer) from anon;
revoke all on function public.retention_sweep(integer) from authenticated;

-- ── 3. Расписание ───────────────────────────────────────────────────────────
--
-- 04:30 UTC — 07:30 по Киеву: после ночного разбора очереди и до начала смены
-- мастера. Не в полночь: в полночь уже стоит пересканирование сроков.

select cron.unschedule('retention-sweep')
 where exists (select 1 from cron.job where jobname = 'retention-sweep');

select cron.schedule('retention-sweep', '30 4 * * *', 'select public.retention_sweep();');
