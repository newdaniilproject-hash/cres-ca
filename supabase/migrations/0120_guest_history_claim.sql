-- 0120. История гостя привязывается к аккаунту по подтверждённой почте.
--
-- ── Чего требовал владелец (19.08.2026) ─────────────────────────────────────
--
-- «Заказы гостя должны сохраняться за его почтой и телефоном, и когда
-- он заведёт аккаунт — подтянуться».
--
-- ── Что сделано и чего НЕ сделано, и почему именно так ──────────────────────
--
-- Привязка идёт по ПОЧТЕ и только по ней. Телефон в продукте не
-- подтверждается ничем: SMS и Viber не подключены и честно бросают
-- ошибку (CLAUDE.md, «Уведомления»). Привязка по неподтверждённому
-- телефону означала бы, что любой, кто наберёт при регистрации чужой
-- номер, получит чужую историю покупок — что у кого куплено, на какую
-- сумму и в каком салоне. Это не «строгость», а разница между функцией
-- и дырой с кнопкой «зарегистрироваться».
--
-- Телефон остаётся ключом к КАРТОЧКЕ КЛИЕНТА внутри заведения (так было
-- и раньше: create_order и create_booking ищут карточку по телефону) —
-- то есть продавец по-прежнему видит одного человека, а не троих. Но
-- аккаунту платформы карточка отдаётся только по подтверждённой почте.
-- Когда появится подтверждение номера, второй ключ добавляется одной
-- веткой в `claim_guest_history` — место для него подготовлено.
--
-- ── Момент привязки ─────────────────────────────────────────────────────────
--
-- Не при регистрации, а при ПОДТВЕРЖДЕНИИ почты: `handle_new_user`
-- срабатывает на вставке в auth.users, то есть до ввода кода из письма.
-- Триггер сидит на переходе `email_confirmed_at` из null в значение —
-- и на смене самой почты, потому что подтверждённая новая почта это
-- ровно то же событие.
--
-- ── Запись на услугу тоже спрашивает почту ──────────────────────────────────
--
-- До сегодня `create_booking` почту не принимал вовсе — у записи был
-- только телефон. То есть привязать гостевую запись было НЕЧЕМ, даже
-- имея подтверждённый аккаунт. Добавлены колонка `bookings.contact_email`
-- и параметр `p_contact_email` последним в подписи (у существующих
-- вызовов параметры именованные, порядок им безразличен).

alter table public.bookings add column if not exists contact_email extensions.citext;

-- ── create_booking: тело 0105 перенесено целиком ────────────────────────────
-- Функция возвращает таблицу, поэтому только drop+create. `set search_path
-- to ''` сохранён: без него citext сравнивался бы ПО РЕГИСТРУ и мимо
-- индекса (0084).
drop function if exists public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text, timestamptz);

create function public.create_booking(
  p_tenant_id uuid,
  p_variant_id uuid,
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_contact_name text,
  p_contact_phone text default null::text,
  p_comment text default null::text,
  p_attribution_source text default null,
  p_attribution_label text default null,
  p_attribution_at timestamptz default null,
  p_contact_email text default null
)
returns bookings
language plpgsql
security definer
set search_path to ''
as $function$
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
  v_attr     public.attribution_source;
  v_email    extensions.citext;
begin
  v_email := nullif(btrim(coalesce(p_contact_email, '')), '')::extensions.citext;

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

  if not v_staffer then
    v_attr := public.attribution_resolve(p_attribution_source, p_attribution_at);
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
  -- Почта — второй ключ к той же карточке (0120). Телефон при записи
  -- необязателен, и без этой ветки один и тот же человек, оставивший
  -- только почту, получал новую карточку на каждую запись.
  if v_customer.id is null and v_email is not null then
    select * into v_customer from public.customers
     where tenant_id = p_tenant_id and email = v_email
     order by created_at limit 1;
  end if;
  if v_customer.id is null then
    insert into public.customers (tenant_id, user_id, name, phone, email)
    values (p_tenant_id, case when v_staffer then null else v_actor end,
            btrim(p_contact_name), p_contact_phone, v_email)
    returning * into v_customer;
  elsif v_email is not null and v_customer.email is null then
    -- Карточка нашлась по телефону, а почты у неё не было: дописываем.
    -- Именно так гостевые записи становятся привязываемыми к аккаунту —
    -- у самой записи почты не спрашивали до 0120.
    update public.customers set email = v_email where id = v_customer.id;
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
     contact_name, contact_phone, contact_email, comment, buyer_user_id, created_by,
     attribution_source, attribution_label)
  values
    (p_tenant_id, v_number, p_staff_id, v_offering.id, v_variant.id, v_customer.id,
     v_period, v_ends, v_offering.title, v_variant.name,
     coalesce(v_variant.price, v_offering.price, 0),
     round(coalesce(v_variant.price, v_offering.price, 0) * v_offering.deposit_percent / 100.0, 2),
     btrim(p_contact_name), p_contact_phone, v_email, p_comment,
     case when v_staffer then null else v_actor end,
     case when v_staffer then v_actor else null end,
     v_attr, nullif(btrim(coalesce(p_attribution_label, '')), ''))
  returning * into v_row;

  if v_attr is not null then
    insert into public.attribution_events (tenant_id, source, label, booking_id, occurred_at)
    values (p_tenant_id, v_attr, nullif(btrim(coalesce(p_attribution_label, '')), ''),
            v_row.id, p_attribution_at);
  end if;

  return v_row;
exception
  when exclusion_violation then
    raise exception 'это время уже занято — выберите другое';
end;
$function$;

comment on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text, timestamptz, text) is
  'Запись на услугу. Атрибуция — 0105. Последний параметр — почта клиента '
  '(0120): по ней гостевая запись привязывается к аккаунту после '
  'подтверждения почты.';

revoke all on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text, timestamptz, text) from public;
revoke all on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text, timestamptz, text) from anon;
revoke all on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text, timestamptz, text) from authenticated;
grant execute on function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text, timestamptz, text) to anon, authenticated;

-- ── Привязка истории ────────────────────────────────────────────────────────
--
-- Одна функция на три события: подтверждение почты при регистрации,
-- подтверждение НОВОЙ почты при её смене и разовая засыпка ниже.
-- Держать три копии этого запроса значило бы гарантированно их
-- рассинхронизировать.
create or replace function public.claim_guest_history(
  p_user uuid,
  p_email extensions.citext
)
returns jsonb
language plpgsql
security definer
set search_path to 'extensions'
as $fn$
declare
  v_cards int := 0;
  v_orders int := 0;
  v_bookings int := 0;
begin
  if p_user is null or p_email is null then
    return jsonb_build_object('cards', 0, 'orders', 0, 'bookings', 0);
  end if;

  -- 1. Карточки клиента. По ОДНОЙ на заведение: `unique (tenant_id, user_id)`
  --    не даст привязать две, а гостевых карточек с одной почтой в одном
  --    заведении бывает несколько (карточка ищется по телефону, и человек,
  --    сменивший номер, заводит вторую). Берём самую раннюю; остальные
  --    остаются гостевыми, но их заказы и записи всё равно привязываются
  --    шагами 2 и 3 — по собственной почте документа.
  with cand as (
    select distinct on (c.tenant_id) c.id
      from public.customers c
     where c.email = p_email
       and c.user_id is null
       and not exists (select 1 from public.customers x
                        where x.tenant_id = c.tenant_id and x.user_id = p_user)
     order by c.tenant_id, c.created_at
  )
  update public.customers c set user_id = p_user
    from cand where c.id = cand.id;
  get diagnostics v_cards = row_count;

  -- 2. Заказы: по собственной почте документа ИЛИ через карточку, которая
  --    теперь принадлежит человеку. Второе условие подхватывает заказы,
  --    оформленные без почты, но на ту же карточку.
  update public.orders o set buyer_user_id = p_user
   where o.buyer_user_id is null
     and (o.contact_email = p_email
          or o.customer_id in (select id from public.customers where user_id = p_user));
  get diagnostics v_orders = row_count;

  -- 3. Записи — так же. Своя почта у записи появилась только в 0120,
  --    поэтому у старых записей работает исключительно путь через карточку.
  update public.bookings b set buyer_user_id = p_user
   where b.buyer_user_id is null
     and (b.contact_email = p_email
          or b.customer_id in (select id from public.customers where user_id = p_user));
  get diagnostics v_bookings = row_count;

  -- Место для второго ключа: как только появится подтверждение НОМЕРА
  -- (SMS или Viber — сегодня их нет, отправка честно бросает ошибку),
  -- сюда добавляется такая же тройка по телефону. Раньше этого момента
  -- привязка по номеру раздаёт чужую историю покупок любому, кто наберёт
  -- чужой номер при регистрации.

  return jsonb_build_object('cards', v_cards, 'orders', v_orders, 'bookings', v_bookings);
end;
$fn$;

-- Зовут её только триггер и засыпка. Человеку она не нужна ни в каком
-- виде: параметром там чужой uuid, то есть право выполнения = право
-- приписать себе чужую историю.
revoke all on function public.claim_guest_history(uuid, extensions.citext) from public;
revoke all on function public.claim_guest_history(uuid, extensions.citext) from anon;
revoke all on function public.claim_guest_history(uuid, extensions.citext) from authenticated;

-- ── Момент срабатывания ─────────────────────────────────────────────────────
create or replace function public.handle_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- Два случая, и оба означают «эта почта теперь подтверждена именно этим
  -- человеком»: подтверждение при регистрации и подтверждение НОВОЙ почты
  -- при её смене. Второй важен не меньше: человек мог заказывать гостем
  -- с адреса, который завёл в аккаунт только сейчас.
  if new.email_confirmed_at is not null and new.email is not null
     and (old.email_confirmed_at is null
          or new.email is distinct from old.email) then
    perform public.claim_guest_history(new.id, new.email::extensions.citext);
  end if;
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at, email on auth.users
  for each row execute function public.handle_email_confirmed();

revoke all on function public.handle_email_confirmed() from public;
revoke all on function public.handle_email_confirmed() from anon;
revoke all on function public.handle_email_confirmed() from authenticated;

-- ── Разовая засыпка ─────────────────────────────────────────────────────────
--
-- Всё, что накопилось до сегодня: у людей с подтверждённой почтой
-- гостевые заказы и записи не привязывались никогда. Идёт после создания
-- функции и один раз — повторный прогон миграции ничего не найдёт,
-- потому что каждый шаг фильтрует по `is null`.
do $$
declare r record;
begin
  for r in select id, email from auth.users
            where email_confirmed_at is not null and email is not null
  loop
    perform public.claim_guest_history(r.id, r.email::extensions.citext);
  end loop;
end $$;
