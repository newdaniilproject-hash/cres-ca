-- ===========================================================================
-- 0087. Ограничитель частоты В БАЗЕ: гостевой заказ и гостевая запись.
--       Шаг 6 плана, хвост «Безопасности» после 0085/0086.
-- ===========================================================================
--
-- ── ЗАЧЕМ ЭТО В БАЗЕ, ЕСЛИ ПРЕДЕЛ УЖЕ ПОСТРОЕН В ПРИЛОЖЕНИИ ────────────────
--
-- Затем, что до приложения этот вызов не доходит. `create_order`
-- и `create_booking` открыты анониму сознательно (правило 7), и браузер
-- зовёт их НАПРЯМУЮ через PostgREST: supabase-js бьёт в
-- `https://<ref>.supabase.co/rest/v1/rpc/create_order`. В этом пути нет
-- ни функции Vercel, ни нашего Cloudflare — значит предел, поставленный
-- там, не видит ни одного гостевого заказа. Единственное место, мимо
-- которого гость пройти не может, — тело самой функции. Отсюда этот файл.
--
-- Прежняя строчка в 0006 («ограничение частоты запросов — обязанность
-- крайнего слоя (Vercel)») была ошибкой в постановке, а не в исполнении:
-- крайнего слоя на этом пути нет.
--
-- ── ОТСТУПЛЕНИЕ ОТ ПРАВИЛА 1 (у каждой строки данных есть tenant_id) ───────
--
-- НАЗЫВАЮ ПРЯМО: у `public.rate_counters` колонки `tenant_id` НЕТ, и это
-- сознательное отступление, а не забытая колонка.
--
-- Причина: правило 1 — про СТРОКИ ДАННЫХ, то есть про то, что принадлежит
-- заведению и показывается человеку. Здесь строк данных нет вовсе: это
-- служебный счётчик обращений, ключ которого — «смысл + адрес», а не
-- «заведение + документ». Приписать ему арендатора нельзя ЧЕСТНО:
--   • перебор идёт ПО АДРЕСУ, а не по магазину. Один и тот же бот
--     колотится в десять витрин; счётчик, разложенный по арендаторам,
--     дал бы ему десять норм вместо одной, то есть перестал бы
--     ограничивать ровно того, ради кого написан;
--   • обращение может прийти до того, как арендатор вообще определён
--     (несуществующий `p_tenant_id` — тоже перебор, и его надо считать).
-- Выдумать `tenant_id` тут — значит соврать в схеме.
--
-- Чем закрыта дыра, которую правило 1 обычно и закрывает (утечка между
-- заведениями): таблица не отдаётся НИКОМУ. RLS включён, политик ноль,
-- права сняты у public, anon и authenticated. Прочитать и записать её
-- может только функция `security definer` из этого файла. Из перебора
-- в `06_isolation.sql` таблица выпадает сама — там перебираются таблицы
-- С КОЛОНКОЙ tenant_id, а этой колонки здесь нет.
--
-- ── КАКОЙ ЗАГОЛОВОК С АДРЕСОМ РЕАЛЬНО ДОЕЗЖАЕТ. ПРОВЕРЕНО НА БОЮ ──────────
--
-- Не из документации. 17.08.2026 на jobvstdwoyifspaiwazn заводилась
-- временная функция, отдающая `current_setting('request.headers', true)`,
-- вызывалась анонимом через `/rest/v1/rpc/` и потом удалялась. Пришло:
--
--   accept, accept-encoding, baggage, cdn-loop, CF-CONNECTING-IP,
--   cf-ew-via, cf-ipcountry, cf-ray, cf-visitor, cf-worker, host,
--   sb-request-id, traceparent, user-agent, x-envoy-expected-rq-timeout-ms,
--   x-envoy-original-path, X-FORWARDED-FOR, x-forwarded-proto
--
-- То есть Supabase тоже стоит за Cloudflare (`cdn-loop`, `cf-ray`),
-- и адрес приезжает ДВАЖДЫ: `cf-connecting-ip` и `x-forwarded-for`.
-- `x-real-ip`, `true-client-ip` и `fly-client-ip` в `request.headers`
-- НЕ приходят вовсе — на них строить нельзя.
--
-- Вторая проверка, по журналу `edge_logs` боевого проекта: у запросов
-- из браузера (`user-agent` с `Mozilla`) `cf_connecting_ip` — это адрес
-- покупателя (79.171.127.103), а у серверных вызовов из Vercel — адреса
-- AWS. Значит заголовок действительно РАЗНЫЙ у разных клиентов, а не
-- один общий адрес прокси. Это и был главный риск: общий счётчик на всех.
--
-- Берём `cf-connecting-ip`, а не `x-forwarded-for`, и вот почему.
-- `x-forwarded-for` клиент может прислать сам — Cloudflare тогда
-- ДОПИСЫВАЕТ настоящий адрес в конец, а не заменяет строку. Разбирать
-- «последний элемент списка» можно, но `cf-connecting-ip` Cloudflare
-- перезаписывает всегда и целиком, то есть подделать его снаружи нельзя.
-- Запасной разбор XFF ниже всё же есть — по ПОСЛЕДНЕМУ элементу — на
-- случай, если путь до функции однажды перестанет идти через Cloudflare.
--
-- ── ЗАГОЛОВКА НЕТ — ПРОПУСКАЕМ, А НЕ ОТКАЗЫВАЕМ ───────────────────────────
--
-- Это главное решение файла, и оно осознанно НЕ в пользу строгости.
-- `request.headers` ставит PostgREST. Кто зовёт `create_order` иначе —
-- сотрудник из psql, фоновая задача, будущая edge-функция, наш же
-- серверный код через service_role — заголовков не имеет вовсе.
-- Отказывать в этом случае значит убить оформление заказа у клиента
-- первым же вызовом из другого места, причём молча и сразу на всех.
-- Ограничитель, который в сомнении ломает продажи, хуже отсутствующего.
--
-- ── ЧЕГО ЭТОТ ФАЙЛ НЕ ДЕЛАЕТ И НЕ МОЖЕТ ───────────────────────────────────
--
-- Он не защищает от распределённого перебора: сто адресов дадут тысячу
-- заказов в час, и база про это ничего не знает. Это честная граница
-- счётчика по адресу, а не недоделка. Ответ на такой перебор — слой,
-- который видит трафик целиком (Cloudflare), и он остаётся за пределами
-- базы.
--
-- И второе, менее очевидное: считаются только УДАВШИЕСЯ обращения.
-- Отметка живёт в той же транзакции, что и заказ, — упал заказ, откатился
-- и счётчик. Значит перебор заведомо неверными `variant_id` этим пределом
-- не ловится. Иначе пришлось бы писать счётчик отдельной транзакцией
-- (`dblink`/автономная), а это плата соединением на каждый гостевой вызов
-- ради сценария, который никаких данных не отдаёт. Названо, чтобы
-- следующий читатель не считал это дырой по недосмотру.
-- ===========================================================================


-- ── 1. Счётчик ────────────────────────────────────────────────────────────

create table if not exists public.rate_counters (
  -- Ключ-строка «смысл:адрес»: 'order:1.2.3.4', 'booking:1.2.3.4'.
  -- Смысл в ключе намеренно — предел на заказы и предел на записи
  -- не должны съедать друг друга.
  bucket       text        primary key,
  hits         int         not null default 0,
  window_start timestamptz not null default now()
);

comment on table public.rate_counters is
  'Службовий лічильник частоти звернень. НЕ орендарні дані — колонки tenant_id немає свідомо, причина в шапці 0087. Читає й пише лише rate_hit().';
comment on column public.rate_counters.bucket is
  'Ключ «сенс:адреса», напр. order:1.2.3.4. Сенс у ключі, щоб межа на замовлення і межа на записи не з''їдали одна одну.';
comment on column public.rate_counters.window_start is
  'Початок поточного вікна. Вікно НЕ подовжується від відмов: заблокований перебір не відсуває собі строк.';

-- Индекс под уборку: без него ночное задание читает таблицу целиком.
create index if not exists rate_counters_window_idx
  on public.rate_counters (window_start);

alter table public.rate_counters enable row level security;

-- Политик НЕТ ни одной, и это не забывчивость: включённый RLS без политик
-- означает «не видно никому», а трогает таблицу только definer-функция
-- ниже. Права, которые в облаке Supabase раздаёт `alter default
-- privileges` каждой новой таблице, снимаются явно — седьмой раз
-- (0036, 0060, 0072, 0076, 0082, 0085, здесь).
revoke all on table public.rate_counters from public, anon, authenticated;


-- ── 2. Адрес обращения ────────────────────────────────────────────────────

create or replace function public.request_ip()
returns inet
language plpgsql
stable
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_raw     text;
  v_parts   text[];
begin
  -- Заголовков нет вовсе (psql, крон, service_role) — это НЕ ошибка
  -- и НЕ повод отказать. Возвращаем null, вызывающий пропускает.
  v_raw := current_setting('request.headers', true);
  if v_raw is null or btrim(v_raw) = '' then
    return null;
  end if;

  begin
    v_headers := v_raw::jsonb;
  exception when others then
    return null;
  end;

  -- Cloudflare перезаписывает этот заголовок целиком, подделать снаружи
  -- нельзя. Проверено на бою 17.08.2026 — разбор в шапке файла.
  v_raw := v_headers ->> 'cf-connecting-ip';

  if v_raw is null or btrim(v_raw) = '' then
    -- Запасной разбор — на случай пути без Cloudflare. Берём ПОСЛЕДНИЙ
    -- элемент: то, что клиент прислал сам, стоит в начале списка,
    -- а адрес, дописанный ближайшим прокси, — в конце.
    v_parts := string_to_array(
                 coalesce(v_headers ->> 'x-forwarded-for', ''), ',');
    if array_length(v_parts, 1) is not null then
      v_raw := btrim(v_parts[array_length(v_parts, 1)]);
    end if;
  end if;

  if v_raw is null or btrim(v_raw) = '' then
    return null;
  end if;

  -- Мусор в заголовке тоже не повод ронять заказ.
  begin
    return btrim(v_raw)::inet;
  exception when others then
    return null;
  end;
end;
$$;

comment on function public.request_ip() is
  'Адреса того, хто звернувся, з request.headers: cf-connecting-ip, запасний — останній елемент x-forwarded-for. Немає заголовка або сміття в ньому — null, і викликач ПРОПУСКАЄ, а не відмовляє.';

-- Ни одного grant: функцию зовут только definer-функции этого проекта,
-- которые и так исполняются от владельца. Анониму она не нужна —
-- девятая точка входа по правилу 7 не заводится.
revoke all on function public.request_ip() from public, anon, authenticated;


-- ── 3. Сам предел ─────────────────────────────────────────────────────────

create or replace function public.rate_hit(
  p_key    text,
  p_limit  int,
  p_window interval default interval '1 hour'
)
returns table (allowed boolean, retry_after int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits  int;
  v_start timestamptz;
begin
  if p_key is null or btrim(p_key) = '' then
    return query select true, 0;  -- считать нечего — пропускаем
    return;
  end if;

  -- ОДНОЙ командой. Два одновременных запроса не разойдутся: второй
  -- ждёт блокировку строки, наложенную первым, и увидит уже изменённое
  -- значение. Двумя командами (select, потом update) здесь была бы гонка,
  -- в которую пролезает сколько угодно параллельных вызовов.
  --
  -- Окно скользит СТУПЕНЬКОЙ, а не непрерывно: истекло — начинаем заново
  -- с единицы. Ступенька позволяет на стыке двух окон сделать до двух
  -- норм подряд; для предела «10 заказов в час» это допустимо, а точное
  -- скользящее окно требовало бы хранить каждое обращение отдельной
  -- строкой — то есть ровно того роста таблицы, от которого мы уходим.
  insert into public.rate_counters as rc (bucket, hits, window_start)
  values (p_key, 1, now())
  on conflict (bucket) do update
     set hits = case when rc.window_start + p_window <= now()
                     then 1 else rc.hits + 1 end,
         -- Окно НЕ подвигается от отказов: иначе тот, кто продолжает
         -- колотиться, сам себе бесконечно продлевает блокировку,
         -- и честный человек за тем же адресом (офис, NAT) не дождётся
         -- разблокировки никогда.
         window_start = case when rc.window_start + p_window <= now()
                             then now() else rc.window_start end
  returning rc.hits, rc.window_start into v_hits, v_start;

  if v_hits <= p_limit then
    return query select true, 0;
  else
    return query select false,
      greatest(1, ceil(date_part('epoch', v_start + p_window - now()))::int);
  end if;
end;
$$;

comment on function public.rate_hit(text, int, interval) is
  'Відмічає звернення за ключем «сенс:адреса» і каже: пустили чи ні і скільки секунд чекати. Однією командою з on conflict — два одночасні виклики не розійдуться. Анониму НЕ видається: її звуть лише create_order і create_booking, які самі security definer.';

-- Ни одного grant, и это не описка. Выдать её анониму — значит завести
-- ДЕВЯТУЮ анонимную точку входа вопреки правилу 7 и покраснеть тестом
-- 06_isolation.sql. Зовут её create_booking и create_order, а они сами
-- security definer и исполняются от владельца, которому revoke не мешает.
revoke all on function public.rate_hit(text, int, interval) from public, anon, authenticated;


-- ── 4. Уборка ─────────────────────────────────────────────────────────────
--
-- Без неё таблица растёт на КАЖДЫЙ новый адрес и не уменьшается никогда:
-- строка живёт вечно после единственного захода случайного бота.
-- Раз в час, на 17-й минуте — не в ноль, чтобы не совпадать с рассылкой
-- уведомлений (`*/5`) и пересканированием (`0 6`).
--
-- Сутки, а не час: строка старше суток не участвует ни в одном окне
-- (самое длинное в проекте — час), но её наличие помогает разобрать
-- жалобу «меня не пускало вчера вечером». Окна длиннее суток этой
-- уборкой не поддерживаются — заведёте такое, поправьте и срок здесь.
select cron.unschedule('rate-counters-sweep')
where exists (select 1 from cron.job where jobname = 'rate-counters-sweep');

select cron.schedule(
  'rate-counters-sweep',
  '17 * * * *',
  $$ delete from public.rate_counters where window_start < now() - interval '24 hours' $$
);


-- ── 5. Вызов в гостевых точках входа ──────────────────────────────────────
--
-- Тело обеих функций перенесено из 0006 и 0010 ДОСЛОВНО и сверено с боем
-- (md5 prosrc совпал с текстом миграций до правки). Добавлен только блок
-- предела. Это то самое правило: «пишешь or replace — прочитай действующее
-- тело и перенеси руками всё, что не собирался трогать» (0076 так унесла
-- сторожа 0052).
--
-- ПРЕДЕЛ НЕ ПРИМЕНЯЕТСЯ К СОТРУДНИКУ ЭТОГО ЖЕ ЗАВЕДЕНИЯ, и это названное
-- отступление от постановки «10 в час на адрес», а не недосмотр. Салон
-- заводит ручные заказы с одного адреса в офисе; в день распродажи
-- одиннадцатый заказ администратора упёрся бы в предел, и продавец
-- увидел бы «не могу оформить» ровно в тот час, когда ему это дороже
-- всего. Сотрудник вошёл в систему, он не аноним и он отвечает своим
-- аккаунтом — перебор гостевых точек это не про него. Признак тот же,
-- что уже используется в обеих функциях: `tenant_can(…, 'orders.write')`.

create or replace function public.create_order(
  p_tenant_id     uuid,
  p_items         jsonb,          -- [{"variant_id": "...", "quantity": 2}, ...]
  p_contact_name  text,
  p_contact_phone text default null,
  p_contact_email text default null,
  p_delivery      jsonb default '{}'::jsonb,
  p_comment       text default null,
  p_source        text default 'storefront',
  p_reserve_hours int  default 72
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_tenant     public.tenants;
  v_is_staffer boolean := false;
  v_customer   public.customers;
  v_number     bigint;
  v_order      public.orders;
  v_item       record;
  v_variant    public.offering_variants;
  v_offering   public.offerings;
  v_res        public.stock_reservations;
  v_count      int := 0;
  v_ip         inet;
  v_gate       record;
begin
  -- Гость обязан представиться. Это минимум по постановке.
  if p_contact_name is null or length(btrim(p_contact_name)) = 0 then
    raise exception 'имя покупателя обязательно';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'заказ без единой позиции невозможен';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'слишком много позиций в одном заказе';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found or v_tenant.status <> 'active' then
    raise exception 'магазин не найден или не активен';
  end if;

  -- Сотрудник магазина может заводить ручной заказ и в закрытой витрине;
  -- посторонним и гостям — только опубликованный магазин.
  v_is_staffer := v_actor is not null and public.tenant_can(p_tenant_id, 'orders.write');
  if not v_is_staffer and not v_tenant.storefront_enabled then
    raise exception 'витрина магазина не опубликована';
  end if;
  if p_source = 'storefront' and v_is_staffer then
    p_source := 'manual';
  end if;

  -- Предел частоты: 10 заказов в час с одного адреса (0087). Ставится
  -- ДО первой записи — иначе отказ оставлял бы за собой карточку клиента
  -- и съеденный номер заказа. Адреса нет — пропускаем, а не отказываем.
  if not v_is_staffer then
    v_ip := public.request_ip();
    if v_ip is not null then
      select * into v_gate
        from public.rate_hit('order:' || host(v_ip), 10, interval '1 hour');
      if not v_gate.allowed then
        raise exception 'слишком много заказов с одного адреса, попробуйте через % с',
          v_gate.retry_after;
      end if;
    end if;
  end if;

  -- Карточка клиента: по аккаунту, иначе по телефону, иначе новая.
  if v_actor is not null and not v_is_staffer then
    select * into v_customer from public.customers
     where tenant_id = p_tenant_id and user_id = v_actor;
  end if;
  if v_customer.id is null and p_contact_phone is not null then
    select * into v_customer from public.customers
     where tenant_id = p_tenant_id and phone = p_contact_phone
     order by created_at limit 1;
  end if;
  if v_customer.id is null then
    insert into public.customers (tenant_id, user_id, name, phone, email)
    values (p_tenant_id,
            case when v_is_staffer then null else v_actor end,
            btrim(p_contact_name), p_contact_phone, p_contact_email)
    returning * into v_customer;
  end if;

  -- Номер: пер-арендаторный счётчик под блокировкой строки.
  insert into public.order_counters (tenant_id) values (p_tenant_id)
  on conflict (tenant_id) do nothing;

  update public.order_counters
     set last_number = last_number + 1
   where tenant_id = p_tenant_id
   returning last_number into v_number;

  insert into public.orders
    (tenant_id, number, customer_id, buyer_user_id,
     contact_name, contact_phone, contact_email,
     delivery_method, delivery_city, delivery_branch, delivery_address,
     comment, source, created_by)
  values
    (p_tenant_id, v_number, v_customer.id,
     case when v_is_staffer then null else v_actor end,
     btrim(p_contact_name), p_contact_phone, p_contact_email,
     p_delivery->>'method', p_delivery->>'city', p_delivery->>'branch', p_delivery->>'address',
     p_comment, p_source,
     case when v_is_staffer then v_actor else null end)
  returning * into v_order;

  -- Строки: цена и название ТОЛЬКО из базы. Позиция обязана быть активной
  -- и принадлежать этому магазину — чужой variant_id не пройдёт.
  for v_item in
    select (e->>'variant_id')::uuid as variant_id,
           (e->>'quantity')::int    as quantity
      from jsonb_array_elements(p_items) e
  loop
    if v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'количество в строке заказа должно быть положительным';
    end if;

    select * into v_variant from public.offering_variants
     where id = v_item.variant_id and tenant_id = p_tenant_id and is_active;
    if not found then
      raise exception 'вариант % недоступен', v_item.variant_id;
    end if;

    select * into v_offering from public.offerings
     where id = v_variant.offering_id;
    if v_offering.status <> 'active' and not v_is_staffer then
      raise exception 'позиция «%» сейчас не продаётся', v_offering.title;
    end if;

    v_res := null;
    if v_variant.track_stock then
      v_res := public.reserve_stock_internal(
        p_tenant_id, v_variant.id, v_item.quantity,
        'order', v_order.id, v_actor,
        now() + make_interval(hours => greatest(p_reserve_hours, 1)));
    end if;

    insert into public.order_items
      (order_id, tenant_id, offering_id, variant_id,
       title, variant_name, unit_price, quantity, reservation_id)
    values
      (v_order.id, p_tenant_id, v_offering.id, v_variant.id,
       v_offering.title, v_variant.name,
       coalesce(v_variant.price, v_offering.price, 0), v_item.quantity,
       v_res.id);

    v_count := v_count + 1;
  end loop;

  insert into public.order_events (order_id, tenant_id, from_status, to_status, actor, note)
  values (v_order.id, p_tenant_id, null, 'new', v_actor,
          format('заказ оформлен, позиций: %s', v_count));

  select * into v_order from public.orders where id = v_order.id;
  return v_order;
end;
$$;

-- Гостевое оформление: функция доступна анониму СОЗНАТЕЛЬНО.
-- Внутри — проверка опубликованности витрины, цены из базы, лимит позиций
-- и, с 0087, предел частоты по адресу. Права переигрываем заново: замена
-- тела их не трогает, но пусть строка стоит рядом с функцией (правило 7).
revoke execute on function public.create_order(uuid, jsonb, text, text, text, jsonb, text, text, int)
  from public;
grant execute on function public.create_order(uuid, jsonb, text, text, text, jsonb, text, text, int)
  to anon, authenticated;


create or replace function public.create_booking(
  p_tenant_id     uuid,
  p_variant_id    uuid,
  p_staff_id      uuid,
  p_starts_at     timestamptz,
  p_contact_name  text,
  p_contact_phone text default null,
  p_comment       text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_staffer  boolean := false;
  v_tenant   public.tenants;
  v_variant  public.offering_variants;
  v_offering public.offerings;
  v_customer public.customers;
  v_number   bigint;
  v_row      public.bookings;
  v_ends     timestamptz;
  v_period   tstzrange;
  v_ip       inet;
  v_gate     record;
begin
  if p_contact_name is null or length(btrim(p_contact_name)) = 0 then
    raise exception 'имя клиента обязательно';
  end if;
  if p_starts_at <= now() then
    raise exception 'нельзя записаться в прошлое';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found or v_tenant.status <> 'active' then
    raise exception 'магазин не найден или не активен';
  end if;

  v_staffer := v_actor is not null and public.tenant_can(p_tenant_id, 'orders.write');
  if not v_staffer and not v_tenant.storefront_enabled then
    raise exception 'запись закрыта: витрина не опубликована';
  end if;

  -- Предел частоты: 10 записей в час с одного адреса (0087). Ставится
  -- ДО первой записи — отказ не должен оставлять за собой ни карточки
  -- клиента, ни съеденного номера. Адреса нет — пропускаем.
  if not v_staffer then
    v_ip := public.request_ip();
    if v_ip is not null then
      select * into v_gate
        from public.rate_hit('booking:' || host(v_ip), 10, interval '1 hour');
      if not v_gate.allowed then
        raise exception 'слишком много записей с одного адреса, попробуйте через % с',
          v_gate.retry_after;
      end if;
    end if;
  end if;

  select * into v_variant from public.offering_variants
   where id = p_variant_id and tenant_id = p_tenant_id and is_active;
  if not found or v_variant.duration_minutes is null then
    raise exception 'услуга недоступна для записи';
  end if;

  select * into v_offering from public.offerings where id = v_variant.offering_id;
  if v_offering.status <> 'active' and not v_staffer then
    raise exception 'услуга «%» сейчас не оказывается', v_offering.title;
  end if;

  if not exists (select 1 from public.staff s
                  where s.id = p_staff_id and s.tenant_id = p_tenant_id and s.is_active) then
    raise exception 'мастер не найден';
  end if;

  v_ends   := p_starts_at + make_interval(mins => v_variant.duration_minutes);
  v_period := tstzrange(p_starts_at,
                        v_ends + make_interval(mins => v_variant.buffer_minutes), '[)');

  -- Отпуск проверяем явно: ограничение исключения его не покрывает.
  if exists (select 1 from public.time_off t
              where t.staff_id = p_staff_id and t.period && v_period) then
    raise exception 'мастер не работает в это время';
  end if;

  -- Карточка клиента: по аккаунту, иначе по телефону, иначе новая.
  if v_actor is not null and not v_staffer then
    select * into v_customer from public.customers
     where tenant_id = p_tenant_id and user_id = v_actor;
  end if;
  if v_customer.id is null and p_contact_phone is not null then
    select * into v_customer from public.customers
     where tenant_id = p_tenant_id and phone = p_contact_phone
     order by created_at limit 1;
  end if;
  if v_customer.id is null then
    insert into public.customers (tenant_id, user_id, name, phone)
    values (p_tenant_id, case when v_staffer then null else v_actor end,
            btrim(p_contact_name), p_contact_phone)
    returning * into v_customer;
  end if;

  insert into public.booking_counters (tenant_id) values (p_tenant_id)
  on conflict (tenant_id) do nothing;
  update public.booking_counters set last_number = last_number + 1
   where tenant_id = p_tenant_id returning last_number into v_number;

  -- Если время занято, здесь сработает bookings_no_overlap и транзакция
  -- откатится целиком. Гонка двух одновременных записей решается базой.
  insert into public.bookings
    (tenant_id, number, staff_id, offering_id, variant_id, customer_id,
     period, service_ends_at, title, variant_name, price, deposit_due,
     contact_name, contact_phone, comment, buyer_user_id, created_by)
  values
    (p_tenant_id, v_number, p_staff_id, v_offering.id, v_variant.id, v_customer.id,
     v_period, v_ends, v_offering.title, v_variant.name,
     coalesce(v_variant.price, v_offering.price, 0),
     round(coalesce(v_variant.price, v_offering.price, 0) * v_offering.deposit_percent / 100.0, 2),
     btrim(p_contact_name), p_contact_phone, p_comment,
     case when v_staffer then null else v_actor end,
     case when v_staffer then v_actor else null end)
  returning * into v_row;

  return v_row;
exception
  when exclusion_violation then
    raise exception 'это время уже занято — выберите другое';
end;
$$;

revoke execute on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text) from public;
grant  execute on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text) to anon, authenticated;
