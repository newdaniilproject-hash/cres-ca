-- ===========================================================================
-- 0085. Защита периметра: журнал подозрительных событий, блокировка после
--       перебора пароля, письмо о входе с нового устройства.
--       Шаг 6 плана (база) + незакрытый хвост шага 4 («Безопасность»).
-- ===========================================================================
--
-- Прежде чем читать код, прочитайте четыре решения. Три из них —
-- об ОТКАЗЕ делать то, что база честно сделать не может, и без этих
-- абзацев следующий человек «починит» их обратно.
--
-- ───────────────────────────────────────────────────────────────────────────
-- РЕШЕНИЕ 1. СЧЁТЧИК НЕУДАЧНЫХ ВХОДОВ ЖИВЁТ НЕ В БАЗЕ. БАЗА ДАЁТ ЗАМОК,
--            СИГНАЛ ПРИНОСИТ РОУТ.
-- ───────────────────────────────────────────────────────────────────────────
--
-- Пароль проверяет GoTrue, а не мы. Что нам доступно, проверено на бою
-- (jobvstdwoyifspaiwazn), а не взято из документации:
--
--   • `auth.audit_log_entries` — ПУСТА. На проекте один пользователь,
--     один сеанс и четыре токена обновления, а в журнале ноль строк.
--     Опираться на неё нельзя даже теоретически: GoTrue пишет туда только
--     СОСТОЯВШИЕСЯ действия (login, logout, token_refreshed, …), и вида
--     «login_failed» в его перечне нет вовсе. Неудачная попытка не
--     оставляет в базе ни одного следа — ни строки, ни счётчика, ничего.
--   • Триггерной точки на неудачный вход не существует: неудачный вход
--     не пишет ни в одну таблицу, а вешать триггер не на что.
--   • `auth.sessions` даёт триггерную точку на УСПЕШНЫЙ вход (строка
--     появляется ровно в момент выдачи сеанса). Ею мы пользуемся ниже.
--   • `auth.users.banned_until` — настоящий замок: это то же поле, которое
--     пишет админский API (`ban_duration`), и его соблюдает сам GoTrue.
--     Право UPDATE у роли postgres проверено.
--
-- Отсюда честное разделение, и его надо назвать вслух, потому что соблазн
-- изобразить «блокировку в базе» велик:
--
--   БАЗА не умеет заметить неудачный вход. Она умеет посчитать и запереть,
--   КОГДА ЕЙ ОБ ЭТОМ СКАЖУТ. Говорит `record_failed_login()`, и звать её
--   обязан серверный роут входа сервисным ключом — сразу после того, как
--   GoTrue вернул «Invalid login credentials».
--
--   Сегодня такого роута НЕТ: `app/(auth)/login/page.tsx` и `app/m/login/`
--   зовут `supabase.auth.signInWithPassword` прямо из браузера, минуя нас.
--   Пока роут не появится, эта миграция — заряженный, но не подключённый
--   замок. Это записано здесь намеренно: «функция есть» и «защита работает»
--   в вопросах входа — разные вещи, и путать их дороже, чем не иметь защиты.
--
--   Чего этот замок не закроет НИКОГДА, даже с роутом: клиент, который
--   ходит в `/auth/v1/token` напрямую (а публичный ключ Supabase лежит
--   в бандле — это не секрет и не может им быть). Перебор по этому адресу
--   ограничивается там, где он проходит: ограничитель Cloudflare перед
--   доменом Supabase и встроенные лимиты самого Supabase Auth. Это часть
--   владельца, не наша, и подменять её функцией в базе — самообман.
--
--   `record_failed_login()` НЕ выдаётся ни анониму, ни `authenticated`:
--   иначе кто угодно, зная почту владельца, запирал бы её десятью
--   вызовами. Только `service_role`, то есть только серверная сторона.
--   Список анонимных точек из правила 7 остаётся в восьми и не растёт.
--
--   Обратная сторона блокировки по учётной записи (её надо знать, а не
--   обнаружить): тот, кто знает почту, может держать человека запертым,
--   долбя неверным паролем. Поэтому замок САМОРАССАСЫВАЮЩИЙСЯ — 15 минут,
--   без ручного разблокирования, — и поэтому же о нём уходит письмо
--   владельцу: запертый вход без объяснения читается как поломка продукта.
--
-- ───────────────────────────────────────────────────────────────────────────
-- РЕШЕНИЕ 2. «НОВОЕ УСТРОЙСТВО» — ЭТО ОТПЕЧАТОК user_agent БЕЗ ВЕРСИЙ.
--            АДРЕС В ОТПЕЧАТОК НЕ ВХОДИТ.
-- ───────────────────────────────────────────────────────────────────────────
--
-- Что вообще есть: `auth.sessions.user_agent` и `auth.sessions.ip`.
-- Больше ничего — куки устройства у нас нет, и завести её может только
-- приложение, не база.
--
-- Почему адрес НЕ участвует в опознании устройства. У мастера с телефона
-- адрес меняется при каждом переходе между вышками и при каждом уходе
-- в Wi-Fi — это несколько раз за смену. Письмо на каждую такую смену
-- перестают открывать через день, а вместе с ним перестают открывать
-- и то единственное письмо, ради которого всё затевалось. Адрес попадает
-- В ПИСЬМО как справка («звідки») и в журнал, но не в отпечаток.
--
-- Почему версии вырезаются. Chrome двигает старший номер раз в четыре
-- недели, iOS — с каждым обновлением. Отпечаток по сырому user_agent
-- объявлял бы «новое устройство» каждому пользователю раз в месяц.
-- Вырезаются все числа: заодно склеиваются Windows 10 и 11 — это
-- осознанная потеря чувствительности в обмен на молчание.
--
-- Что этот отпечаток НЕ ловит, и это надо знать: злоумышленник с тем же
-- Chrome на той же Windows от него не отличим. Отпечаток по user_agent
-- отличает «зашли с другого телефона/браузера», а не «зашёл не тот
-- человек». Обещать второе нельзя.
--
-- Почему всё-таки заводится таблица `known_devices`, хотя 0076 прямо
-- запретила вторую копию сеансов. Это НЕ копия сеансов, и разница
-- проверяемая: `auth.sessions` — состояние («кто сейчас в системе»),
-- строки оттуда пропадают при выходе, при истечении и при каждом
-- срабатывании `tenant_members_audit` (0080 рвёт сеансы на смену прав).
-- Вопрос «видели ли мы это устройство раньше» по такой таблице ответить
-- НЕЛЬЗЯ: после любого принудительного выхода все устройства снова стали
-- бы новыми, и владелец получил бы письмо на каждое. `known_devices` —
-- это история («какие устройства у человека были»), три поля, никакого
-- состояния сеанса, и разъехаться с `auth.sessions` ей не в чем.
--
-- ПЕРВОЕ устройство человека письма НЕ порождает. Иначе, во-первых,
-- письмо приходило бы сразу после регистрации; во-вторых, в день
-- применения этой миграции письмо ушло бы на КАЖДЫЙ вход каждого
-- существующего пользователя — таблица-то пуста. Первый вход просто
-- запоминается молча.
--
-- ───────────────────────────────────────────────────────────────────────────
-- РЕШЕНИЕ 3. ЖУРНАЛ ПОДОЗРИТЕЛЬНЫХ СОБЫТИЙ — ОТДЕЛЬНАЯ ТАБЛИЦА,
--            А НЕ РАСШИРЕНИЕ `audit_log`. ЭТО ОТХОД ОТ УКАЗАНИЯ ПЛАНА.
-- ───────────────────────────────────────────────────────────────────────────
--
-- План говорит «`audit_log` уже есть — расширять его, а не заводить
-- второй». Здесь заводится второй, и вот четыре причины; главная первая.
--
--  1. АУДИТОРИЯ РАЗНАЯ, И РАСШИРЕНИЕ БЫЛО БЫ УТЕЧКОЙ. `audit_log`
--     читается политикой по `compliance.read`. Проверено на бою: это
--     право есть у ролей owner, admin, manager, operator, viewer И
--     inspector. Inspector — государственный проверяющий, которого мы
--     сами впустили смотреть санитарные журналы. Положить в ту же таблицу
--     неудачные входы владельца, его адреса и его устройства значит
--     показать их проверяющему и каждому оператору. Ни одна политика
--     этого не разделит: таблица одна, право одно.
--  2. `audit_log.tenant_id` — NOT NULL, и это не случайность: на нём
--     стоит вся изоляция журнала, по нему же его чистит `purge_tenant_rows`
--     и `delete_my_account` (0058). Неудачный вход по почте, которой нет
--     ни в одном закладе, арендатора не имеет вовсе. Сделать колонку
--     nullable ради этого — ослабить единственную гарантию действующего
--     журнала ради чужих строк.
--  3. ФОРМА РАЗНАЯ. `audit_log.action` ограничен `insert/update/delete`,
--     а содержимое — `entity/entity_id/changes`, то есть «что стало
--     с этой строкой». Неудачный вход — не правка строки. Он влез бы
--     туда как `action='insert', entity='login'`, то есть ложью в той
--     самой колонке, по которой журнал читают и индексируют.
--  4. ПИСАТЕЛЬ РАЗНЫЙ. В `audit_log` пишет ровно один `audit_row()`,
--     повешенный на семнадцать таблиц. Сюда пишут триггер на `auth.sessions`
--     и роуты — то есть источники, которых у `audit_row()` нет и быть
--     не может.
--
-- Что при этом взято у `audit_log` целиком, потому что оно верное:
-- неизменяемость строки (правится новой строкой, не подчисткой старой),
-- отсутствие внешних ключей (журнал переживает и заклад, и увольнение),
-- сторож поверх отсутствия политик и чтение через `tenants_with()`.
--
-- ───────────────────────────────────────────────────────────────────────────
-- РЕШЕНИЕ 4. «ОБРАЩЕНИЕ К ЧУЖОМУ АРЕНДАТОРУ» БАЗА ПОЙМАТЬ НЕ МОЖЕТ.
--            ЛОВИМ РОВНО ТО, ЧТО ЛОВИТСЯ.
-- ───────────────────────────────────────────────────────────────────────────
--
-- Три пути обращения к чужому, и ни один не даёт базе записать событие:
--
--   • ЧТЕНИЕ. RLS не роняет запрос, а возвращает ноль строк. Запрос
--     «покажи заказы заклада X» от чужого и запрос от своего, у которого
--     заказов пока нет, для базы НЕРАЗЛИЧИМЫ — оба успешны, оба пусты.
--     Отличать их «по подозрительности» значит гадать, а гадание в журнале
--     безопасности хуже пустоты: по нему потом принимают решение об увольнении.
--   • ЗАПИСЬ. `with check` отбивает строку с чужим `tenant_id` ошибкой —
--     но ошибка ОТКАТЫВАЕТ ТРАНЗАКЦИЮ ЦЕЛИКОМ, вместе с любой записью
--     в журнал, которую мы бы в ней сделали. Строка о попытке исчезает
--     ровно вместе с попыткой.
--   • ФУНКЦИИ с `p_tenant_id`, которые проверяют право и делают `raise` —
--     то же самое: `raise` откатывает и свой журнал.
--
-- Тот же откат закрывает и третий пункт задания — «попытки правки
-- неизменяемых записей». Сторожа санитарных журналов, техкарт и финансов
-- роняют транзакцию; писать из неё в журнал бессмысленно, запись
-- откатится. Обходные пути (dblink ради автономной транзакции, pg_net —
-- у которого очередь тоже транзакционна) стоят дороже, чем стоит событие,
-- и открывают новую дверь ради записи о закрытой.
--
-- Поэтому база даёт ОДНУ честную точку — `log_security_event()`, которую
-- зовёт роут, ПОЙМАВШИЙ ошибку, то есть уже вне откаченной транзакции.
-- И эта точка не верит вызывающему на слово:
--   • автор берётся из `auth.uid()`, подделать его нельзя;
--   • вид события — из закрытого списка, и виды входа через неё
--     не записываются вовсе;
--   • «обращение к чужому» принимается ТОЛЬКО если арендатор
--     действительно не свой, а «правка неизменяемого» — только если свой.
--     Сочинить событие, которого не могло быть, нельзя;
--   • не чаще одной строки в минуту на пару «вид × автор × арендатор»,
--     иначе журнал владельца топится в спаме за один цикл.
-- Остаточная честность: подтвердить своими строками можно только СВОИ
-- действия — оклеветать соседа этой функцией нельзя, можно только себя.
-- ===========================================================================


-- ── 1. Журнал подозрительных событий ──────────────────────────────────────

create table if not exists public.security_events (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  kind        text not null check (kind in (
                'login.failed',            -- неудачный вход (приносит роут)
                'login.locked',            -- учётная запись заперта на 15 хв
                'login.new_device',         -- вход с устройства, которого не было
                'tenant.foreign_access',    -- обращение к чужому закладу
                'record.immutable_attempt' -- попытка правки неизменяемой записи
              )),
  -- Nullable намеренно, и это единственное отступление от правила 1 в файле.
  -- Событие входа принадлежит ЧЕЛОВЕКУ, а не закладу: попытка войти по почте,
  -- которой нет ни в одном закладе, арендатора не имеет, и приписать ей
  -- какой-нибудь — значит выдумать. Утечь это не может: политика ниже
  -- сравнивает `tenant_id in (select tenants_with(…))`, а null не равен
  -- ничему, то есть бестенантные строки не видны НИКОМУ напрямую.
  -- Владельцу они показываются функцией `security_log()`, которая сама
  -- сводит их с составом команды.
  tenant_id   uuid,
  actor_id    uuid,
  -- Почта строкой и в нижнем регистре. citext здесь не используется
  -- намеренно: под `set search_path = ''` его оператор `=` не виден и
  -- молча подменяется текстовым, то есть сравнение идёт ПО РЕГИСТРУ
  -- (разобрано в 0084). Приводим к нижнему регистру при записи и при
  -- чтении — тогда подмены оператора бояться нечего.
  actor_email text,
  ip          inet,
  user_agent  text,
  detail      jsonb not null default '{}'::jsonb
);

comment on table public.security_events is
  'Незмінюваний журнал підозрілих подій: невдалі входи, блокування, вхід з нового пристрою, звернення до чужого орендаря, спроби правки незмінних записів. Чому окрема таблиця, а не audit_log — у шапці 0085.';
comment on column public.security_events.tenant_id is
  'null = подія людини, а не закладу (вхід). Політика її не віддає нікому; власнику її зводить security_log().';
comment on column public.security_events.actor_email is
  'Те, що ввели у поле пошти. Може не збігатися з жодним акаунтом — перебір адрес видно саме за такими рядками.';

create index if not exists security_events_kind_actor_idx
  on public.security_events (kind, actor_id, at desc);
create index if not exists security_events_tenant_idx
  on public.security_events (tenant_id, at desc) where tenant_id is not null;
create index if not exists security_events_email_idx
  on public.security_events (actor_email, at desc);

alter table public.security_events enable row level security;

-- Читает тот, кто вправе видеть команду, — как и журнал прав (0076).
-- НЕ compliance.read: см. причину 1 в шапке.
drop policy if exists security_events_read on public.security_events;
create policy security_events_read on public.security_events
  for select to authenticated
  using (tenant_id in (select public.tenants_with('team.read')));

-- Политик insert/update/delete нет намеренно: пишут только definer-функции
-- этого файла. Права, которые в облаке Supabase выдаёт `alter default
-- privileges` на каждую новую таблицу, снимаются явно — шестой раз
-- (0036, 0060, 0072, 0076, 0082, здесь).
revoke all on table public.security_events from anon, authenticated;
grant select on table public.security_events to authenticated;

create or replace function public.security_events_immutable()
returns trigger language plpgsql as $fn$
begin
  -- Единственная законная щель — удаление аккаунта (0058). Флаг живёт
  -- только внутри своей транзакции, снаружи запрет действует как действовал.
  if coalesce(current_setting('app.purging_account', true), 'off') = 'on'
     and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'журнал безпеки незмінний: % заборонено', tg_op;
end $fn$;

revoke all on function public.security_events_immutable() from public, anon, authenticated;

drop trigger if exists security_events_no_change on public.security_events;
create trigger security_events_no_change
  before update or delete on public.security_events
  for each row execute function public.security_events_immutable();


-- ── 2. Устройства, которые у человека уже были ────────────────────────────

create table if not exists public.known_devices (
  user_id     uuid not null,
  fingerprint text not null,
  user_agent  text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  last_ip     inet,
  primary key (user_id, fingerprint)
);

-- Колонки tenant_id здесь нет, и это не забывчивость: устройство
-- принадлежит человеку, а человек может состоять в нескольких закладах.
-- Тот же случай, что и у `profiles`, — и политика построена так же.
comment on table public.known_devices is
  'Історія пристроїв людини (відбиток user_agent без версій). Не копія auth.sessions: там стан сеансу, тут — чи бачили ми цей пристрій раніше. Причина — у шапці 0085.';

alter table public.known_devices enable row level security;

drop policy if exists known_devices_self_read on public.known_devices;
create policy known_devices_self_read on public.known_devices
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.known_devices from anon, authenticated;
grant select on table public.known_devices to authenticated;

-- Отпечаток. Ни одной таблицы не трогает — чистая функция от строки.
create or replace function public.device_fingerprint(p_user_agent text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select md5(btrim(regexp_replace(
           regexp_replace(lower(coalesce(p_user_agent, '')), '[0-9]+(\.[0-9]+)*', '', 'g'),
           '\s+', ' ', 'g')));
$fn$;

comment on function public.device_fingerprint(text) is
  'Відбиток пристрою: user_agent у нижньому регістрі з вирізаними числами. Адреса в нього НЕ входить — причина у шапці 0085.';

revoke all on function public.device_fingerprint(text) from public, anon, authenticated;


-- ── 3. Внутренний писатель журнала ────────────────────────────────────────
-- Отдельная функция, чтобы у всех трёх писателей была одна форма строки.

create or replace function public.security_event_write(
  p_kind       text,
  p_tenant_id  uuid,
  p_actor_id   uuid,
  p_email      text,
  p_ip         inet,
  p_user_agent text,
  p_detail     jsonb
) returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_id bigint;
begin
  insert into public.security_events
    (kind, tenant_id, actor_id, actor_email, ip, user_agent, detail)
  values
    (p_kind, p_tenant_id, p_actor_id, lower(nullif(btrim(coalesce(p_email, '')), '')),
     p_ip, p_user_agent, coalesce(p_detail, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $fn$;

revoke all on function public.security_event_write(text, uuid, uuid, text, inet, text, jsonb)
  from public, anon, authenticated;


-- ── 4. Неудачные входы и блокировка на 15 минут ───────────────────────────

create or replace function public.record_failed_login(
  p_email      text,
  p_ip         inet default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_user   uuid;
  v_who    text;
  v_since  timestamptz;
  v_fails  int;
  v_until  timestamptz;
  r        record;
begin
  if v_email = '' then
    return jsonb_build_object('locked', false, 'attempts', 0);
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = v_email;

  perform public.security_event_write(
    'login.failed', null, v_user, v_email, p_ip, p_user_agent, '{}'::jsonb);

  if v_user is null then
    -- Почты нет ни у кого. Запирать некого, считать нечего — но строка
    -- в журнале остаётся: перебор адресов виден именно по ней.
    return jsonb_build_object('locked', false, 'attempts', 0);
  end if;

  -- Окно считается от ПОСЛЕДНЕЙ блокировки, а не от начала времён:
  -- иначе одиннадцатая попытка за сутки запирала бы снова и снова.
  select coalesce(max(e.at), '-infinity'::timestamptz) into v_since
    from public.security_events e
   where e.kind = 'login.locked' and e.actor_id = v_user;

  select count(*) into v_fails
    from public.security_events e
   where e.kind = 'login.failed'
     and e.actor_id = v_user
     and e.at > greatest(v_since, now() - interval '15 minutes');

  -- Удачный вход счётчик НЕ обнуляет — намеренно. Пока подбирают пароль,
  -- законный вход владельца с телефона не должен давать подбирающему
  -- ещё десять попыток. Окно и так закрывается само за 15 минут.
  if v_fails < 10 then
    return jsonb_build_object('locked', false, 'attempts', v_fails);
  end if;

  v_until := now() + interval '15 minutes';

  -- Настоящий замок, а не наша выдумка: это то же поле, что пишет
  -- админский API (`ban_duration`), и соблюдает его сам GoTrue.
  update auth.users set banned_until = v_until where id = v_user;

  -- Сеансы НЕ рвём. Тот, кого сейчас пытаются подобрать, может в эту
  -- минуту работать; выкинуть его из приложения значит подарить
  -- нападающему отказ в обслуживании за десять неверных паролей.
  perform public.security_event_write(
    'login.locked', null, v_user, v_email, p_ip, p_user_agent,
    jsonb_build_object('attempts', v_fails, 'until', v_until));

  select coalesce(p.full_name, p.email::text) into v_who
    from public.profiles p where p.id = v_user;

  -- Письмо СТАВИТСЯ В ОЧЕРЕДЬ, а не отправляется отсюда: падение почтовика
  -- внутри этой транзакции откатило бы саму блокировку (CLAUDE.md,
  -- «Уведомления»).
  -- ⚠️ `po.email` НЕ приводится к text, и это не мелочь стиля: p_to_email
  -- у enqueue_notification имеет тип citext, а text → citext объявлено
  -- расширением как ASSIGNMENT, не IMPLICIT. Приведение ::text здесь
  -- означает «функции с такой сигнатурой не существует» — то есть письмо
  -- не ставится вовсе. Так 0023 сломала оформление заказов и запись
  -- на услуги целиком, и чинила это 0028. Не «упрощать» обратно.
  for r in
    select o.tenant_id, o.user_id as owner_id, po.email as owner_email,
           coalesce(po.locale, 'uk') as locale
      from public.tenant_members m
      join public.tenant_members o on o.tenant_id = m.tenant_id and o.role = 'owner'
      join public.profiles po on po.id = o.user_id
     where m.user_id = v_user
       and po.email is not null
  loop
    perform public.enqueue_notification(
      p_tenant_id  => r.tenant_id,
      p_event      => 'security.account_locked',
      p_channel    => 'email'::public.notification_channel,
      p_dedupe_key => 'sec:lock:' || v_user::text || ':' ||
                      extract(epoch from v_until)::bigint::text,
      p_payload    => jsonb_build_object(
                        'who',      coalesce(v_who, v_email),
                        'email',    v_email,
                        'attempts', v_fails,
                        'until',    to_char(v_until, 'DD.MM HH24:MI'),
                        'ip',       coalesce(host(p_ip), 'невідома'),
                        'device',   coalesce(nullif(btrim(coalesce(p_user_agent,'')), ''), 'невідомий')),
      p_user_id    => r.owner_id,
      p_to_email   => r.owner_email,
      p_ref_type   => 'security',
      p_locale     => r.locale);
  end loop;

  return jsonb_build_object('locked', true, 'until', v_until, 'attempts', v_fails);
end $fn$;

comment on function public.record_failed_login(text, inet, text) is
  'Рахує невдалі входи і замикає акаунт на 15 хвилин після десятого. Кличе серверний роут входу сервісним ключем: сама база невдалого входу НЕ БАЧИТЬ (див. шапку 0085).';

-- Только серверная сторона. Анониму или вошедшему эта функция дала бы
-- запирание чужого акаунта по знанию одной лишь почты.
revoke all on function public.record_failed_login(text, inet, text)
  from public, anon, authenticated;
grant execute on function public.record_failed_login(text, inet, text) to service_role;


-- ── 5. Вход с нового устройства ───────────────────────────────────────────
--
-- Триггер на `auth.sessions`: строка там появляется ровно в момент выдачи
-- сеанса, то есть на состоявшемся входе любым способом — пароль, код
-- из письма, Google.
--
-- ⚠️ ЭТА ФУНКЦИЯ НЕ ИМЕЕТ ПРАВА УПАСТЬ. Она исполняется внутри транзакции
-- GoTrue, создающей сеанс: любое необработанное исключение здесь — это
-- НЕВОЗМОЖНОСТЬ ВОЙТИ для всех сразу. Поэтому тело целиком обёрнуто
-- в перехват, и при любой ошибке вход проходит молча, без письма.

create or replace function public.auth_session_device_watch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_fp    text;
  v_known boolean;
  v_any   boolean;
  v_who   text;
  r       record;
begin
  begin
    v_fp := public.device_fingerprint(new.user_agent);

    select true into v_known
      from public.known_devices d
     where d.user_id = new.user_id and d.fingerprint = v_fp;

    select exists (select 1 from public.known_devices d where d.user_id = new.user_id)
      into v_any;

    insert into public.known_devices (user_id, fingerprint, user_agent, last_ip, last_seen)
    values (new.user_id, v_fp, new.user_agent, new.ip, now())
    on conflict (user_id, fingerprint)
      do update set last_seen = now(),
                    last_ip   = excluded.last_ip;

    -- Знакомое устройство — молчим. Первое устройство человека — тоже:
    -- иначе письмо приходит сразу после регистрации, а в день применения
    -- миграции ушло бы на каждый вход каждого существующего пользователя.
    if coalesce(v_known, false) or not v_any then
      return null;
    end if;

    perform public.security_event_write(
      'login.new_device', null, new.user_id,
      (select p.email::text from public.profiles p where p.id = new.user_id),
      new.ip, new.user_agent,
      jsonb_build_object('fingerprint', v_fp));

    select coalesce(p.full_name, p.email::text) into v_who
      from public.profiles p where p.id = new.user_id;

    -- Про `po.email` без ::text — см. тот же абзац в record_failed_login
    -- и миграцию 0028.
    for r in
      select o.tenant_id, o.user_id as owner_id, po.email as owner_email,
             coalesce(po.locale, 'uk') as locale
        from public.tenant_members m
        join public.tenant_members o on o.tenant_id = m.tenant_id and o.role = 'owner'
        join public.profiles po on po.id = o.user_id
       where m.user_id = new.user_id
         and po.email is not null
    loop
      perform public.enqueue_notification(
        p_tenant_id  => r.tenant_id,
        p_event      => 'security.new_device',
        p_channel    => 'email'::public.notification_channel,
        -- Один раз на устройство на заклад, навсегда: повторные входы
        -- с того же телефона писем не порождают.
        p_dedupe_key => 'sec:device:' || new.user_id::text || ':' || v_fp,
        p_payload    => jsonb_build_object(
                          'who',    coalesce(v_who, 'співробітник'),
                          'device', coalesce(nullif(btrim(coalesce(new.user_agent,'')), ''), 'невідомий'),
                          'ip',     coalesce(host(new.ip), 'невідома'),
                          'when',   to_char(now(), 'DD.MM HH24:MI')),
        p_user_id    => r.owner_id,
        p_to_email   => r.owner_email,
        p_ref_type   => 'security',
        p_locale     => r.locale);
    end loop;

    return null;
  exception when others then
    -- Вход важнее письма о входе, поэтому наружу ошибка не идёт. Но и
    -- проглатывать её насовсем нельзя: тихий сторож, сломавшийся полгода
    -- назад, не отличим от сторожа, которому нечего сказать. warning
    -- уходит в журнал Postgres и на сам вход не влияет.
    raise warning 'сторож нового пристрою не спрацював: %', sqlerrm;
    return null;
  end;
end $fn$;

comment on function public.auth_session_device_watch() is
  'Помічає вхід з пристрою, якого в людини ще не було: пише подію і ставить лист власнику в чергу. Ніколи не падає — інакше зламався б сам вхід.';

revoke all on function public.auth_session_device_watch() from public, anon, authenticated;
-- Тригерну функцію виконує той, хто робить INSERT, а сеанси створює GoTrue
-- від ролі supabase_auth_admin. Без цього гранта вхід падав би на
-- «permission denied for function» — тобто зламався б повністю.
grant execute on function public.auth_session_device_watch() to supabase_auth_admin;

drop trigger if exists session_device_watch on auth.sessions;
create trigger session_device_watch
  after insert on auth.sessions
  for each row execute function public.auth_session_device_watch();


-- ── 6. Точка для роутов: чужой арендатор и попытка правки неизменяемого ───

create or replace function public.log_security_event(
  p_kind      text,
  p_tenant_id uuid,
  p_detail    jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_mine  boolean;
begin
  if v_actor is null then
    raise exception 'не автентифіковано';
  end if;

  -- Виды входа сюда не принимаются вовсе: их пишет только сама база.
  if p_kind not in ('tenant.foreign_access', 'record.immutable_attempt') then
    raise exception 'цей вид події застосунок не записує: %', p_kind;
  end if;

  if p_tenant_id is null then
    raise exception 'подія без орендаря не приймається';
  end if;

  v_mine := p_tenant_id in (select public.my_tenants());

  -- Сочинить событие, которого не могло быть, нельзя.
  if p_kind = 'tenant.foreign_access' and v_mine then
    raise exception 'орендар свій — це не звернення до чужого';
  end if;
  if p_kind = 'record.immutable_attempt' and not v_mine then
    raise exception 'правка в чужому закладі неможлива — така подія не приймається';
  end if;

  -- Ограничитель: одна строка в минуту на «вид × автор × арендатор».
  -- Без него журнал владельца топится за один цикл.
  if exists (select 1 from public.security_events e
              where e.kind = p_kind
                and e.actor_id = v_actor
                and e.tenant_id = p_tenant_id
                and e.at > now() - interval '1 minute') then
    return false;
  end if;

  perform public.security_event_write(
    p_kind, p_tenant_id, v_actor,
    (select p.email::text from public.profiles p where p.id = v_actor),
    null, null,
    -- Текст от клиента не кладём как есть: две известные строки с обрезкой.
    jsonb_build_object(
      'what', left(coalesce(p_detail ->> 'what', ''), 200),
      'where', left(coalesce(p_detail ->> 'where', ''), 200)));
  return true;
end $fn$;

comment on function public.log_security_event(text, uuid, jsonb) is
  'Єдина точка, якою застосунок дописує в журнал безпеки. Автор береться з токена, вид — із закритого списку, невідповідні події відхиляються. Чому це не робить сама база — у шапці 0085.';

revoke all on function public.log_security_event(text, uuid, jsonb) from public, anon;
grant execute on function public.log_security_event(text, uuid, jsonb) to authenticated;


-- ── 7. Журнал для экрана владельца ────────────────────────────────────────
--
-- SECURITY DEFINER по той же причине, что и `permission_audit_log()` (0080):
-- читает `profiles` чужих людей. Изоляцию проверяет собственный WHERE.
-- Он же сводит бестенантные события входа с составом команды — те строки
-- политика не отдаёт никому, и иначе владелец не увидел бы, что его
-- сотрудника пятнадцать минут подбирали.

create or replace function public.security_log(p_tenant_id uuid, p_limit int default 200)
returns table (
  id          bigint,
  at          timestamptz,
  kind        text,
  actor_id    uuid,
  actor_name  text,
  actor_email text,
  ip          text,
  user_agent  text,
  detail      jsonb
)
language sql
stable
security definer
set search_path to ''
as $fn$
  select e.id, e.at, e.kind, e.actor_id,
         coalesce(p.full_name, p.email::text),
         e.actor_email,
         host(e.ip),
         e.user_agent,
         e.detail
    from public.security_events e
    left join public.profiles p on p.id = e.actor_id
   where p_tenant_id in (select public.tenants_with('team.read'))
     and (
       e.tenant_id = p_tenant_id
       or (e.tenant_id is null
           and exists (select 1 from public.tenant_members m
                        where m.tenant_id = p_tenant_id
                          and m.user_id = e.actor_id))
     )
   order by e.at desc, e.id desc
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
$fn$;

comment on function public.security_log(uuid, int) is
  'Журнал безпеки закладу: події з його tenant_id плюс події входу його людей. Ізоляцію перевіряє власний WHERE по team.read.';

revoke all on function public.security_log(uuid, int) from public, anon;
grant execute on function public.security_log(uuid, int) to authenticated;


-- ── 8. Шаблоны писем ──────────────────────────────────────────────────────
--
-- Тексты живут в базе, а не в коде отправки (0011): арендатор вправе их
-- переопределить. Первая строка отвечает на «что мне с этим делать»,
-- а не приветствует (CLAUDE.md, «Письма»).

insert into public.notification_templates (tenant_id, event, channel, locale, subject, body, is_active)
values
  (null, 'security.account_locked', 'email', 'uk',
   'Вхід заблоковано на 15 хвилин — {{who}}',
   'Якщо це були не ви — після розблокування змініть пароль. ' ||
   'Обліковий запис {{email}} заблоковано до {{until}} після {{attempts}} невдалих спроб входу. ' ||
   'Адреса, з якої пробували: {{ip}}. Пристрій: {{device}}. ' ||
   'Блокування знімається саме, звертатися нікуди не треба.', true),
  (null, 'security.new_device', 'email', 'uk',
   'Вхід з нового пристрою — {{who}}',
   'Якщо це були не ви — відкрийте «Команда → Сеанси» і завершіть сеанс, ' ||
   'а потім змініть пароль. {{who}} увійшов з пристрою, якого раніше не було: {{device}}. ' ||
   'Адреса: {{ip}}. Час: {{when}}. ' ||
   'Лист про цей пристрій надходить один раз — наступні входи з нього тихі.', true)
on conflict do nothing;


-- ── 9. Удаление аккаунта забирает и это ───────────────────────────────────
--
-- `purge_tenant_rows()` (0058) сам подхватит `security_events`: у неё есть
-- tenant_id, и она попадает в обход графа. Но остаются строки, к закладу
-- не привязанные, — события входа человека и его устройства. Их надо
-- убрать явно, иначе после удаления аккаунта в базе останутся почта,
-- адреса и отпечатки устройств удалённого человека.
--
-- Тело `delete_my_account()` перенесено из 0058 ДОСЛОВНО, сверено с боем
-- (совпадает побайтово), и добавлены ровно две строки в конце. Правило
-- из CLAUDE.md: «пишешь or replace — прочитай действующее тело и перенеси
-- руками всё, что не собирался трогать» (так 0076 унесла из сторожа 0052
-- ветку INSERT).

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_files  bigint;
begin
  if v_uid is null then
    raise exception 'не автентифіковано';
  end if;

  -- Спершу перераховуємо файли по всіх закладах, які підуть разом із людиною.
  -- Розмежування — першим сегментом шляху <tenant_id>/… (правило 1).
  select count(*) into v_files
    from storage.objects o
   where exists (
     select 1
       from public.tenant_members tm
      where tm.user_id = v_uid
        and tm.role = 'owner'
        and o.name like tm.tenant_id::text || '/%'
        and (select count(*) from public.tenant_members x
              where x.tenant_id = tm.tenant_id and x.role = 'owner') = 1);

  if v_files > 0 then
    raise exception 'спочатку видаліть файли закладу через Storage API: залишилось %', v_files
      using hint = 'Видалення рядків storage.objects із SQL заборонене захистом Supabase (protect_objects_delete). Файли прибирає застосунок, базу — ця функція.';
  end if;

  -- true = лише на поточну транзакцію. Це єдина законна шпарина в захисті
  -- незмінних журналів, і вона існує рівно заради видалення акаунта.
  perform set_config('app.purging_account', 'on', true);

  for v_tenant in
    select tm.tenant_id
      from public.tenant_members tm
     where tm.user_id = v_uid
       and tm.role = 'owner'
       and (select count(*) from public.tenant_members x
             where x.tenant_id = tm.tenant_id and x.role = 'owner') = 1
  loop
    -- Обхід графа залежностей: діти раніше за батьків, інакше RESTRICT (див. шапку).
    perform public.purge_tenant_rows(v_tenant);
    delete from public.tenants where id = v_tenant;
    -- Аж тепер журнал: до цього рядка тригер audit_row() дописував у нього
    -- запис на кожне видалення, тож раніше чистити його не мало сенсу.
    delete from public.audit_log where tenant_id = v_tenant;
  end loop;

  delete from public.tenant_members where user_id = v_uid;
  delete from public.audit_log where actor_id = v_uid;
  -- Додано 0085. Журнал безпеки і відбитки пристроїв — теж персональні дані.
  delete from public.security_events where actor_id = v_uid;
  delete from public.known_devices where user_id = v_uid;
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
end;
$fn$;

comment on function public.delete_my_account() is
  'Видаляє акаунт і всі заклади, де людина — єдиний власник. Вимога Apple 5.1.1(v). З 0085 забирає ще журнал безпеки і відбитки пристроїв.';
