-- 22_security_perimeter.sql — защита периметра (миграция 0085).
--
-- Файл проверяет ровно те обещания, которые 0085 берёт на себя, и каждое —
-- ПОПЫТКОЙ ЕГО НАРУШИТЬ. Обещаний шесть:
--
--   1) десять неудачных входов запирают учётную запись на 15 минут,
--      и это настоящий замок (`auth.users.banned_until`), а не отметка
--      в нашей таблице; счётчик считается от последней блокировки;
--   2) запереть чужой аккаунт по знанию одной лишь почты нельзя:
--      `record_failed_login()` не выдана ни анониму, ни вошедшему;
--   3) блокировка не рвёт сеансы — иначе десять неверных паролей
--      выкидывали бы работающего человека из приложения;
--   4) письмо владельцу СТАВИТСЯ В ОЧЕРЕДЬ, и под него есть шаблон;
--   5) вход с нового устройства замечается один раз, а смена версии
--      браузера и смена адреса новым устройством НЕ считаются;
--   6) журнал безопасности неизменяем, изолирован по арендатору,
--      подделать в нём автора или сочинить чужое событие нельзя,
--      и он уходит вместе с удалённым аккаунтом.
--
-- Отдельно проверяется то, что дороже всего сломать: триггер на
-- `auth.sessions` НЕ ИМЕЕТ ПРАВА УРОНИТЬ ВХОД. Для этого таблице
-- устройств временно вешается заведомо невыполнимое ограничение.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('ee220000-0000-0000-0000-000000000001','sec-owner@test.ua'),
  ('ee220000-0000-0000-0000-000000000002','sec-worker@test.ua'),
  ('ee220000-0000-0000-0000-000000000003','sec-alien@test.ua')
on conflict (id) do nothing;

insert into public.tenants (id, slug, name, status) values
  ('ee22aaaa-0000-0000-0000-000000000001','sec-shop','Салон Периметр','active'),
  ('ee22bbbb-0000-0000-0000-000000000002','sec-alien','Салон Чужий','active')
on conflict (id) do nothing;

insert into public.tenant_members (tenant_id, user_id, role) values
  ('ee22aaaa-0000-0000-0000-000000000001','ee220000-0000-0000-0000-000000000001','owner'),
  ('ee22aaaa-0000-0000-0000-000000000001','ee220000-0000-0000-0000-000000000002','operator'),
  ('ee22bbbb-0000-0000-0000-000000000002','ee220000-0000-0000-0000-000000000003','owner')
on conflict do nothing;


-- ═════════════════════════════════════════════════════════════════════════
-- Новое устройство
-- ═════════════════════════════════════════════════════════════════════════

\echo '--- 0085: первый вход человека письма НЕ порождает, но устройство запоминается'
-- Сеансы заводит платформа, а не приложение, поэтому пишем от служебной роли —
-- как это делает 09_team.sql.
insert into auth.sessions (user_id, user_agent, ip) values
  ('ee220000-0000-0000-0000-000000000002',
   'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
   '203.0.113.10');

do $$
declare v_dev int; v_mail int; v_evt int;
begin
  select count(*) into v_dev from public.known_devices
   where user_id = 'ee220000-0000-0000-0000-000000000002';
  select count(*) into v_mail from public.notification_outbox
   where event = 'security.new_device';
  select count(*) into v_evt from public.security_events
   where kind = 'login.new_device' and actor_id = 'ee220000-0000-0000-0000-000000000002';

  if v_dev <> 1 then
    raise exception 'ПРОВАЛ: перший вхід не запамʼятав пристрій (рядків %)', v_dev;
  end if;
  if v_mail > 0 then
    raise exception 'ПРОВАЛ: перший пристрій людини надіслав лист — так у день застосування міграції лист пішов би на кожен вхід';
  end if;
  if v_evt > 0 then
    raise exception 'ПРОВАЛ: перший пристрій записаний як «новий»';
  end if;
  raise notice 'ok — перший пристрій запамʼятали мовчки';
end $$;

\echo '--- 0085: обновление браузера и смена адреса новым устройством не считаются'
-- Тот же телефон: другая версия Android, другая версия Chrome, другой адрес
-- (переход между вышками). Отпечаток обязан совпасть — иначе письмо уходило бы
-- раз в месяц каждому и раз в час мастеру с телефона.
insert into auth.sessions (user_id, user_agent, ip) values
  ('ee220000-0000-0000-0000-000000000002',
   'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0.6778.85 Mobile Safari/537.36',
   '198.51.100.77');

do $$
declare v_dev int; v_mail int;
begin
  select count(*) into v_dev from public.known_devices
   where user_id = 'ee220000-0000-0000-0000-000000000002';
  select count(*) into v_mail from public.notification_outbox
   where event = 'security.new_device';

  if v_dev <> 1 then
    raise exception 'ПРОВАЛ: оновлення версії породило другий пристрій (рядків %)', v_dev;
  end if;
  if v_mail > 0 then
    raise exception 'ПРОВАЛ: оновлення браузера або зміна адреси надіслали лист про новий пристрій';
  end if;
  raise notice 'ok — версії вирізаються, адреса у відбиток не входить';
end $$;

\echo '--- 0085: вход с другого устройства замечается и ставит письмо владельцу'
insert into auth.sessions (user_id, user_agent, ip) values
  ('ee220000-0000-0000-0000-000000000002',
   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
   '203.0.113.55');

do $$
declare v_dev int; v_mail int; v_evt int; v_to text;
begin
  select count(*) into v_dev from public.known_devices
   where user_id = 'ee220000-0000-0000-0000-000000000002';
  select count(*) into v_evt from public.security_events
   where kind = 'login.new_device' and actor_id = 'ee220000-0000-0000-0000-000000000002';
  select count(*), min(o.to_email::text) into v_mail, v_to
    from public.notification_outbox o
   where o.event = 'security.new_device'
     and o.tenant_id = 'ee22aaaa-0000-0000-0000-000000000001';

  if v_dev <> 2 then
    raise exception 'ПРОВАЛ: інший пристрій не додався (рядків %)', v_dev;
  end if;
  if v_evt <> 1 then
    raise exception 'ПРОВАЛ: подія про новий пристрій не записана (рядків %)', v_evt;
  end if;
  if v_mail <> 1 then
    raise exception 'ПРОВАЛ: лист власнику не поставлено в чергу (рядків %)', v_mail;
  end if;
  if v_to <> 'sec-owner@test.ua' then
    raise exception 'ПРОВАЛ: лист пішов не власнику, а на %', v_to;
  end if;
  raise notice 'ok — новий пристрій помічено, лист власнику стоїть у черзі';
end $$;

\echo '--- 0085: повторный вход с того же устройства второго письма не порождает'
insert into auth.sessions (user_id, user_agent, ip) values
  ('ee220000-0000-0000-0000-000000000002',
   'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
   '192.0.2.200');

do $$
declare v_mail int;
begin
  select count(*) into v_mail from public.notification_outbox
   where event = 'security.new_device'
     and tenant_id = 'ee22aaaa-0000-0000-0000-000000000001';
  if v_mail <> 1 then
    raise exception 'ПРОВАЛ: другий вхід з того самого пристрою надіслав ще один лист (усього %)', v_mail;
  end if;
  raise notice 'ok — лист про пристрій один раз, далі тихо';
end $$;

\echo '--- 0085: сторож входа не имеет права уронить вход'
-- Ломаем таблицу устройств заведомо невыполнимым ограничением. Если триггер
-- пропустит ошибку наружу — упадёт INSERT в auth.sessions, то есть в бою
-- НИКТО НЕ СМОЖЕТ ВОЙТИ. Проверяем именно это, а не наличие блока exception.
alter table public.known_devices
  add constraint tmp_break_device_watch check (fingerprint = 'нікого') not valid;

do $$
begin
  insert into auth.sessions (user_id, user_agent, ip) values
    ('ee220000-0000-0000-0000-000000000001',
     'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/17.0','203.0.113.99');
  raise notice 'ok — вхід пройшов попри зламану таблицю пристроїв';
exception when others then
  raise exception 'ПРОВАЛ: помилка сторожа зламала вхід — %', sqlerrm;
end $$;

alter table public.known_devices drop constraint tmp_break_device_watch;

\echo '--- 0085: вход человека без профиля и без заклада тоже не падает'
do $$
begin
  insert into auth.sessions (user_id, user_agent, ip) values
    ('ee220000-0000-0000-0000-0000000000ff', null, null);
  insert into auth.sessions (user_id, user_agent, ip) values
    ('ee220000-0000-0000-0000-0000000000ff','Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0','::1');
  raise notice 'ok — вхід без профілю і без закладу пройшов';
exception when others then
  raise exception 'ПРОВАЛ: вхід невідомої людини зламався — %', sqlerrm;
end $$;

-- Владелец теперь тоже с устройством — понадобится в проверке удаления аккаунта.
insert into auth.sessions (user_id, user_agent, ip) values
  ('ee220000-0000-0000-0000-000000000001',
   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36','203.0.113.98');


-- ═════════════════════════════════════════════════════════════════════════
-- Неудачные входы и блокировка
-- ═════════════════════════════════════════════════════════════════════════

\echo '--- 0085: запереть чужой аккаунт по знанию почты нельзя ни анониму, ни вошедшему'
do $$
declare v_anon boolean := false; v_auth boolean := false;
begin
  begin
    perform set_config('request.jwt.claims','{"role":"anon"}', true);
    execute 'set local role anon';
    perform public.record_failed_login('sec-owner@test.ua', null, null);
    execute 'reset role';
  exception when others then
    execute 'reset role'; v_anon := true;
  end;

  begin
    execute 'set local role authenticated';
    perform public.record_failed_login('sec-owner@test.ua', null, null);
    execute 'reset role';
  exception when others then
    execute 'reset role'; v_auth := true;
  end;

  if not v_anon then
    raise exception 'ПРОВАЛ: анонім може замикати чужі акаунти — десять викликів і власник не увійде';
  end if;
  if not v_auth then
    raise exception 'ПРОВАЛ: будь-який вхідний користувач може замкнути чужий акаунт';
  end if;
  raise notice 'ok — лічильник невдалих входів кличе лише серверна сторона';
end $$;

\set QUIET on
select test.login('ee220000-0000-0000-0000-000000000001');
\set QUIET off

\echo '--- 0085: девять попыток не запирают, десятая запирает на 15 минут'
do $$
declare i int; v_res jsonb; v_banned timestamptz;
begin
  for i in 1..9 loop
    v_res := public.record_failed_login('sec-worker@test.ua','203.0.113.7'::inet,'curl/8.5');
    if (v_res ->> 'locked')::boolean then
      raise exception 'ПРОВАЛ: замкнуло вже на % спробі', i;
    end if;
  end loop;

  v_res := public.record_failed_login('sec-worker@test.ua','203.0.113.7'::inet,'curl/8.5');
  if not (v_res ->> 'locked')::boolean then
    raise exception 'ПРОВАЛ: десята невдала спроба не замкнула акаунт: %', v_res;
  end if;

  -- Замок обязан быть НАСТОЯЩИМ: GoTrue смотрит в banned_until, а не в наши
  -- таблицы. Отметка «заперто» в своей таблице — это не блокировка входа.
  select u.banned_until into v_banned from auth.users u
   where u.id = 'ee220000-0000-0000-0000-000000000002';
  if v_banned is null or v_banned <= now() then
    raise exception 'ПРОВАЛ: banned_until не виставлений (%) — GoTrue такий «замок» не побачить', v_banned;
  end if;
  if v_banned > now() + interval '16 minutes' then
    raise exception 'ПРОВАЛ: замкнули довше ніж на 15 хвилин — до %', v_banned;
  end if;
  raise notice 'ok — десята спроба замкнула акаунт до %', v_banned;
end $$;

\echo '--- 0085: блокировка не рвёт сеансы работающего человека'
do $$
declare v_sess int;
begin
  select count(*) into v_sess from auth.sessions
   where user_id = 'ee220000-0000-0000-0000-000000000002';
  if v_sess = 0 then
    raise exception 'ПРОВАЛ: підбір пароля викинув людину з застосунку — це відмова в обслуговуванні за десять невірних паролів';
  end if;
  raise notice 'ok — сеанси на місці: %', v_sess;
end $$;

\echo '--- 0085: письмо владельцу стоит в очереди, и под него есть шаблон'
do $$
declare v_mail int; v_to text; v_tpl int;
begin
  select count(*), min(o.to_email::text) into v_mail, v_to
    from public.notification_outbox o
   where o.event = 'security.account_locked'
     and o.tenant_id = 'ee22aaaa-0000-0000-0000-000000000001';
  if v_mail <> 1 then
    raise exception 'ПРОВАЛ: лист про блокування не поставлено в чергу (рядків %)', v_mail;
  end if;
  if v_to <> 'sec-owner@test.ua' then
    raise exception 'ПРОВАЛ: лист про блокування пішов не власнику, а на %', v_to;
  end if;

  -- Рядок у черзі без шаблону — це п'ять приречених спроб і status = failed.
  select count(*) into v_tpl
    from public.notification_outbox o
   where o.ref_type = 'security'
     and not exists (
       select 1 from public.notification_templates t
        where t.tenant_id is null and t.event = o.event
          and t.channel = o.channel and t.locale = o.locale and t.is_active);
  if v_tpl > 0 then
    raise exception 'ПРОВАЛ: % рядків черги безпеки без активного шаблону — вони приречені', v_tpl;
  end if;
  raise notice 'ok — лист власнику в черзі, шаблон під нього є';
end $$;

\echo '--- 0085: счётчик считается от последней блокировки, а не с начала времён'
-- Отдельным запросом, то есть в НОВОЙ транзакции: иначе `now()` не сдвинется
-- и проверка выродилась бы в тавтологию.
select (public.record_failed_login('sec-worker@test.ua','203.0.113.7'::inet,'curl/8.5')
        ->> 'attempts')::int as спроб_після_замка_ожид_1;

do $$
declare v_res jsonb;
begin
  v_res := public.record_failed_login('sec-worker@test.ua','203.0.113.7'::inet,'curl/8.5');
  if (v_res ->> 'locked')::boolean then
    raise exception 'ПРОВАЛ: одинадцята спроба замкнула знову — лічильник не обнулився після блокування';
  end if;
  raise notice 'ok — після блокування відлік починається заново';
end $$;

\echo '--- 0085: неизвестная почта не роняет функцию и никого не запирает'
do $$
declare v_res jsonb; v_row int; v_banned int;
begin
  v_res := public.record_failed_login('нікого-немає@test.ua','203.0.113.8'::inet,'curl/8.5');
  if (v_res ->> 'locked')::boolean then
    raise exception 'ПРОВАЛ: замкнуло неіснуючий акаунт';
  end if;
  select count(*) into v_row from public.security_events
   where kind = 'login.failed' and actor_email = 'нікого-немає@test.ua';
  if v_row <> 1 then
    raise exception 'ПРОВАЛ: перебір неіснуючих адрес у журналі не видно (рядків %)', v_row;
  end if;
  select count(*) into v_banned from auth.users where banned_until > now();
  if v_banned <> 1 then
    raise exception 'ПРОВАЛ: замкнутих акаунтів % замість одного', v_banned;
  end if;
  raise notice 'ok — перебір адрес видно, замикати нема кого';
end $$;


-- ═════════════════════════════════════════════════════════════════════════
-- Журнал: неизменяемость, изоляция, невозможность сочинить событие
-- ═════════════════════════════════════════════════════════════════════════

\echo '--- 0085: строку журнала нельзя ни переписать, ни стереть даже служебной ролью'
do $$
declare v_upd boolean := false; v_del boolean := false;
begin
  begin
    update public.security_events set kind = 'login.failed' where kind = 'login.locked';
  exception when others then v_upd := true;
  end;
  begin
    delete from public.security_events where kind = 'login.locked';
  exception when others then v_del := true;
  end;

  if not v_upd then
    raise exception 'ПРОВАЛ: журнал безпеки переписується — тоді це не доказ, а файл, який підчистили';
  end if;
  if not v_del then
    raise exception 'ПРОВАЛ: рядок журналу безпеки стирається';
  end if;
  raise notice 'ok — журнал безпеки незмінний';
end $$;

\echo '--- 0085: чужой владелец не видит ни строк заклада, ни бестенантных событий'
\set QUIET on
select test.login('ee220000-0000-0000-0000-000000000003');
\set QUIET off
do $$
declare v_all int; v_log int;
begin
  execute 'set local role authenticated';
  select count(*) into v_all from public.security_events;
  select count(*) into v_log from public.security_log('ee22aaaa-0000-0000-0000-000000000001');
  execute 'reset role';

  if v_all > 0 then
    raise exception 'ПРОВАЛ: чужий власник бачить % рядків журналу безпеки', v_all;
  end if;
  if v_log > 0 then
    raise exception 'ПРОВАЛ: security_log віддав чужий заклад (% рядків)', v_log;
  end if;
  raise notice 'ok — чужому не видно нічого';
end $$;

\echo '--- 0085: владельцу видны и события заклада, и входы его людей'
\set QUIET on
select test.login('ee220000-0000-0000-0000-000000000001');
\set QUIET off
do $$
declare v_lock int; v_dev int; v_direct int;
begin
  execute 'set local role authenticated';
  select count(*) filter (where kind = 'login.locked'),
         count(*) filter (where kind = 'login.new_device')
    into v_lock, v_dev
    from public.security_log('ee22aaaa-0000-0000-0000-000000000001');
  -- Те же строки напрямую из таблицы политика НЕ отдаёт: у них нет арендатора.
  select count(*) into v_direct from public.security_events
   where kind in ('login.locked','login.new_device');
  execute 'reset role';

  if v_lock < 1 then
    raise exception 'ПРОВАЛ: власник не бачить блокування свого співробітника';
  end if;
  if v_dev < 1 then
    raise exception 'ПРОВАЛ: власник не бачить входу з нового пристрою';
  end if;
  if v_direct > 0 then
    raise exception 'ПРОВАЛ: безтенантні події видно напряму з таблиці (% рядків) — політика їх не ріже', v_direct;
  end if;
  raise notice 'ok — власник бачить їх через security_log, а не з таблиці';
end $$;

\echo '--- 0085: событие, которого не могло быть, журнал не принимает'
\set QUIET on
select test.login('ee220000-0000-0000-0000-000000000002');
\set QUIET off
do $$
declare v_own boolean := false; v_alien boolean := false; v_login boolean := false; v_anon boolean := false;
begin
  execute 'set local role authenticated';

  -- «Звернення до чужого» про СВІЙ заклад — вигадка.
  begin
    perform public.log_security_event('tenant.foreign_access',
      'ee22aaaa-0000-0000-0000-000000000001', '{}'::jsonb);
  exception when others then v_own := true;
  end;

  -- «Спроба правки незмінного» у ЧУЖОМУ закладі — теж вигадка: туди не видно.
  begin
    perform public.log_security_event('record.immutable_attempt',
      'ee22bbbb-0000-0000-0000-000000000002', '{}'::jsonb);
  exception when others then v_alien := true;
  end;

  -- Види входу застосунок не пише взагалі: інакше можна намалювати
  -- «десять невдалих входів власника» і не мати до них жодного стосунку.
  begin
    perform public.log_security_event('login.failed',
      'ee22aaaa-0000-0000-0000-000000000001', '{}'::jsonb);
  exception when others then v_login := true;
  end;

  execute 'reset role';

  begin
    perform set_config('request.jwt.claims','{"role":"anon"}', true);
    execute 'set local role anon';
    perform public.log_security_event('tenant.foreign_access',
      'ee22bbbb-0000-0000-0000-000000000002', '{}'::jsonb);
    execute 'reset role';
  exception when others then
    execute 'reset role'; v_anon := true;
  end;

  if not v_own   then raise exception 'ПРОВАЛ: свій заклад записали як «звернення до чужого»'; end if;
  if not v_alien then raise exception 'ПРОВАЛ: прийнято «правку незмінного» у чужому закладі'; end if;
  if not v_login then raise exception 'ПРОВАЛ: застосунок може малювати невдалі входи'; end if;
  if not v_anon  then raise exception 'ПРОВАЛ: анонім дописує в журнал безпеки'; end if;
  raise notice 'ok — вигадані події відхилено, анонім не пише';
end $$;

\echo '--- 0085: автор события берётся из токена, а не со слов вызывающего'
\set QUIET on
select test.login('ee220000-0000-0000-0000-000000000002');
\set QUIET off
do $$
declare v_ok boolean; v_actor uuid; v_second boolean; v_rows int;
begin
  execute 'set local role authenticated';
  v_ok := public.log_security_event('tenant.foreign_access',
            'ee22bbbb-0000-0000-0000-000000000002',
            jsonb_build_object('what','GET /app/orders','where','чужий заклад'));
  -- Ограничитель: вторая строка той же пары «вид × автор × арендатор»
  -- в ту же минуту не пишется, иначе журнал власника топиться за цикл.
  v_second := public.log_security_event('tenant.foreign_access',
            'ee22bbbb-0000-0000-0000-000000000002', '{}'::jsonb);
  execute 'reset role';

  if not v_ok then
    raise exception 'ПРОВАЛ: чесна подія про чужий заклад не записалася';
  end if;
  if v_second then
    raise exception 'ПРОВАЛ: обмежувач не працює — журнал можна затопити';
  end if;

  select count(*) into v_rows
    from public.security_events
   where kind = 'tenant.foreign_access'
     and tenant_id = 'ee22bbbb-0000-0000-0000-000000000002';
  select actor_id into v_actor
    from public.security_events
   where kind = 'tenant.foreign_access'
     and tenant_id = 'ee22bbbb-0000-0000-0000-000000000002'
   order by at desc, id desc limit 1;
  if v_rows <> 1 then
    raise exception 'ПРОВАЛ: рядків про чужий заклад % замість одного', v_rows;
  end if;
  if v_actor <> 'ee220000-0000-0000-0000-000000000002' then
    raise exception 'ПРОВАЛ: автор події %, а має бути той, чий токен', v_actor;
  end if;
  raise notice 'ok — автор із токена, друга спроба за хвилину відкинута';
end $$;

\echo '--- 0085: чужой владелец видит попытку в СВОЁМ журнале, но не более того'
\set QUIET on
select test.login('ee220000-0000-0000-0000-000000000003');
\set QUIET off
do $$
declare v_n int;
begin
  execute 'set local role authenticated';
  select count(*) into v_n from public.security_log('ee22bbbb-0000-0000-0000-000000000002')
   where kind = 'tenant.foreign_access';
  execute 'reset role';
  if v_n <> 1 then
    raise exception 'ПРОВАЛ: власник не бачить звернення до свого закладу ззовні (рядків %)', v_n;
  end if;
  raise notice 'ok — власник бачить, що до нього стукали';
end $$;

\echo '--- 0086: ни одна функция проекта не оставлена с изменяемым search_path'
-- Не про 0085 в отдельности: список закрытый на всю схему. Функция без
-- заданного пути разбирает имена по тому пути, который задал вызывающий, —
-- а половина функций здесь SECURITY DEFINER. 0085 такую функцию завела
-- (сторож журнала безопасности), и нашёл это анализатор, а не прогон.
-- Теперь найдёт прогон. Функции расширений исключены по тому же признаку,
-- что и в 06_isolation.sql: на голом стенде pgcrypto кладёт свои в public,
-- и правило проекта про них не говорит.
do $$
declare без_шляху text;
begin
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ')
    into без_шляху
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prokind = 'f'
     and p.proconfig is null
     and not exists (select 1 from pg_depend d
                      where d.objid = p.oid and d.classid = 'pg_proc'::regclass
                        and d.deptype = 'e');
  if без_шляху is not null then
    raise exception 'ПРОВАЛ: функції зі змінюваним search_path — %', без_шляху;
  end if;
  raise notice 'ok — у кожної функції схеми public search_path заданий';
end $$;

\echo '--- 0085: анониму не открыта ни одна функция периметра'
do $$
declare лишние text;
begin
  select string_agg(p.proname, ', ') into лишние
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('record_failed_login','log_security_event','security_log',
                       'security_event_write','device_fingerprint',
                       'auth_session_device_watch','security_events_immutable')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if лишние is not null then
    raise exception 'ПРОВАЛ: анониму открыты функции периметра — %', лишние;
  end if;
  raise notice 'ok — анонім не виконує жодної';
end $$;


-- ═════════════════════════════════════════════════════════════════════════
-- Удаление аккаунта забирает журнал и устройства
-- ═════════════════════════════════════════════════════════════════════════

\echo '--- 0085: удаление аккаунта уносит журнал безопасности и отпечатки устройств'
-- Сначала кладём событие заклада от лица владельца — иначе проверка «после
-- удаления ноль» ничего не доказывает: ноль был бы и до неё.
\set QUIET on
select test.login('ee220000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select public.log_security_event('record.immutable_attempt',
         'ee22aaaa-0000-0000-0000-000000000001',
         jsonb_build_object('what','update sanitation_solutions','where','журнал дезрозчинів'))
       as подія_записана_ожид_t;
reset role;

do $$
declare v_dev int; v_evt int; v_tenant int;
begin
  select count(*) into v_dev from public.known_devices
   where user_id = 'ee220000-0000-0000-0000-000000000001';
  select count(*) into v_evt from public.security_events
   where actor_id = 'ee220000-0000-0000-0000-000000000001';
  select count(*) into v_tenant from public.security_events
   where tenant_id = 'ee22aaaa-0000-0000-0000-000000000001';

  if v_dev = 0 or v_evt = 0 or v_tenant = 0 then
    raise exception 'ПРОВАЛ: нічого видаляти — пристроїв %, подій людини %, подій закладу %; перевірка не значима',
      v_dev, v_evt, v_tenant;
  end if;
  raise notice 'до видалення: пристроїв %, подій людини %, подій закладу %', v_dev, v_evt, v_tenant;
end $$;

\set QUIET on
select test.login('ee220000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select public.delete_my_account();
reset role;

do $$
declare v_dev int; v_evt int; v_tenant int;
begin
  select count(*) into v_dev from public.known_devices
   where user_id = 'ee220000-0000-0000-0000-000000000001';
  select count(*) into v_evt from public.security_events
   where actor_id = 'ee220000-0000-0000-0000-000000000001';
  select count(*) into v_tenant from public.security_events
   where tenant_id = 'ee22aaaa-0000-0000-0000-000000000001';

  if v_dev > 0 then
    raise exception 'ПРОВАЛ: відбитки пристроїв видаленої людини лишились (% рядків)', v_dev;
  end if;
  if v_evt > 0 then
    raise exception 'ПРОВАЛ: події видаленої людини лишились (% рядків)', v_evt;
  end if;
  if v_tenant > 0 then
    raise exception 'ПРОВАЛ: журнал безпеки видаленого закладу лишився (% рядків)', v_tenant;
  end if;
  raise notice 'ok — журнал безпеки і пристрої пішли разом з акаунтом';
end $$;
