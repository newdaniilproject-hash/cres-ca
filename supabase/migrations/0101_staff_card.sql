-- ===========================================================================
-- 0101. Карточка мастера: два места, где расписание молча врёт.
-- ===========================================================================
--
-- ЗАЧЕМ ЭТА МИГРАЦИЯ ВООБЩЕ. Таблицы `staff`, `working_hours` и `time_off`
-- существуют с 0010, политики на них стоят, а экрана, который бы их правил,
-- в продукте нет: `staff.is_active` («у відпустці, записи не приймає»)
-- переключать негде, и экран команды честно отсылает «в картку майстра»,
-- которой не существует. Карточка добавляется сейчас, и вместе с ней
-- закрываются две дыры, которые до появления экрана были незаметны просто
-- потому, что данные никто не заводил руками.
--
-- Обе дыры одного рода: они не роняют ничего и не показывают ошибку —
-- они делают расписание неправильным ТИХО. Именно поэтому они здесь,
-- в базе, а не проверками в форме: форма — одна из точек входа, а
-- PostgREST отдаёт таблицу напрямую любому, у кого есть право.
--
-- ── 1. ПЕРЕСЕКАЮЩИЕСЯ ПРОМЕЖУТКИ РАБОЧЕГО ДНЯ ──────────────────────────────
--
-- `available_slots` (0010) джойнит `working_hours` и на КАЖДОЕ окно гонит
-- generate_series. Два пересекающихся промежутка одного мастера в один день
-- дают два окна — и один и тот же час приходит в список слотов дважды.
-- Двойной записи из этого не выйдет (её ловит ограничение исключения на
-- `bookings`), а вот покупатель видит «10:00» две строки подряд и читает
-- это как поломку витрины.
--
-- Промежутки, которые СОПРИКАСАЮТСЯ, разрешены намеренно: 09:00–13:00 и
-- 13:00–18:00 — это обеденный перерыв, самый частый способ заполнения дня.
-- Условие пересечения строгое с обеих сторон, поэтому касание проходит.
--
-- ── 2. ГРАНИЦЫ ОТПУСКА И ЧАСОВОЙ ПОЯС МАСТЕРА ──────────────────────────────
--
-- `time_off.period` — это `tstzrange`, то есть моменты времени, а человек
-- заводит ДНИ: «с 20-го по 25-е». Превращать дни в моменты можно только
-- в часовом поясе мастера — тот же `staff.timezone`, в котором
-- `available_slots` разворачивает рабочие часы (`(day + starts_at)
-- at time zone m.timezone`).
--
-- Если это делать в браузере, в данные протекает часовой пояс ТОГО, КТО
-- ЗАВОДИТ. Администратор из Варшавы, ставящий отпуск киевскому мастеру,
-- промахнётся на час, а на границе суток — на целый день: последний день
-- отпуска окажется рабочим. Ошибка невидимая — в списке отпуск выглядит
-- правильно, а в слотах появляется приём.
--
-- Поэтому границы считает база, одной функцией, рядом с тем местом,
-- которое их потом читает. Верхняя граница — начало дня СЛЕДУЮЩЕГО за
-- последним (`p_to + 1`) и скобка `[)`: «по 25-е включительно» человек
-- понимает как весь 25-й день целиком.
--
-- УДАЛЕНИЕ отпуска своей функции не получило и не должно: обычный DELETE
-- проходит политику `time_off_delete` (`orders.write`), считать там нечего.
-- ===========================================================================

-- ── 1. Запрет пересечения промежутков рабочего дня ──────────────────────────

create or replace function public.working_hours_no_overlap()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if exists (
    select 1
      from public.working_hours w
     where w.staff_id = new.staff_id
       and w.weekday  = new.weekday
       and w.id <> new.id
       -- Строго с обеих сторон: касание границ (13:00 к 13:00) — это
       -- обеденный перерыв, а не пересечение.
       and new.starts_at < w.ends_at
       and w.starts_at   < new.ends_at
  ) then
    raise exception 'проміжки робочого дня перетинаються: % — % вже зайнято',
      new.starts_at, new.ends_at;
  end if;
  return new;
end;
$$;

comment on function public.working_hours_no_overlap() is
  'Два промежутка одного мастера в один день не пересекаются: available_slots делает из каждого окна свой generate_series, и час приходит в список дважды. Касание границ разрешено — это обеденный перерыв.';

drop trigger if exists working_hours_no_overlap on public.working_hours;
create trigger working_hours_no_overlap
  before insert or update on public.working_hours
  for each row execute function public.working_hours_no_overlap();

-- Правило 7 и урок 0094: триггерную функцию не должно быть видно как RPC.
-- Три строки, а не одна: `authenticated` получает право на каждый новый
-- объект схемы через `alter default privileges`, и отзыв у public его
-- не трогает (0036, 0061, 0094, 0095).
revoke all on function public.working_hours_no_overlap() from public;
revoke all on function public.working_hours_no_overlap() from anon;
revoke all on function public.working_hours_no_overlap() from authenticated;

-- ── 2. Отпуск заводится днями, границы считает база ─────────────────────────

create or replace function public.add_time_off(
  p_tenant_id uuid,
  p_staff_id  uuid,
  p_kind      public.time_off_kind,
  p_from      date,
  p_to        date,
  p_note      text default null
) returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_tz text;
  v_id uuid;
begin
  if not public.tenant_can(p_tenant_id, 'orders.write') then
    raise exception 'недостатньо прав: orders.write у закладі %', p_tenant_id;
  end if;

  -- Мастер обязан принадлежать ЭТОМУ заведению. Без проверки функция
  -- с правами владельца стала бы способом завести строку чужому мастеру,
  -- подставив его id: правило 1 держится не только политиками, но и
  -- тем, что definer-функция сама сверяет принадлежность.
  select s.timezone into v_tz
    from public.staff s
   where s.id = p_staff_id and s.tenant_id = p_tenant_id;
  if v_tz is null then
    raise exception 'майстра % немає в закладі %', p_staff_id, p_tenant_id;
  end if;

  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'некоректний період: % — %', p_from, p_to;
  end if;

  insert into public.time_off (tenant_id, staff_id, kind, period, note, created_by)
  values (
    p_tenant_id, p_staff_id, coalesce(p_kind, 'other'),
    tstzrange(
      (p_from::timestamp)      at time zone v_tz,
      ((p_to + 1)::timestamp)  at time zone v_tz,
      '[)'),
    nullif(btrim(coalesce(p_note, '')), ''),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.add_time_off(uuid, uuid, public.time_off_kind, date, date, text) is
  'Отпуск и перерыв мастера. Человек задаёт ДНИ, границы tstzrange считаются в часовом поясе мастера — том же, в котором available_slots разворачивает рабочие часы. Верхняя граница — начало следующего за последним дня.';

-- Правило 7. Анониму здесь делать нечего: список анонимных точек входа
-- закрыт (их восемь, сверяется 06_isolation.sql), и девятая отдельным
-- решением, а не побочным эффектом миграции.
revoke all on function public.add_time_off(uuid, uuid, public.time_off_kind, date, date, text) from public;
revoke all on function public.add_time_off(uuid, uuid, public.time_off_kind, date, date, text) from anon;
revoke all on function public.add_time_off(uuid, uuid, public.time_off_kind, date, date, text) from authenticated;
grant execute on function public.add_time_off(uuid, uuid, public.time_off_kind, date, date, text) to authenticated;
