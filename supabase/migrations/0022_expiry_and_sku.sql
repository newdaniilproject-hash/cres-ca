-- 0022_expiry_and_sku.sql
-- Предупреждения о сроках годности начинают доходить до людей + артикул.
--
-- Что было сломано. Триггер ёмкости из 0014 честно ставил в очередь два
-- предупреждения — за 14 и за 7 дней, гасил их при списании банки
-- и пересчитывал при смене партии. Но ставил их каналом push и с пустым
-- получателем: ни user_id, ни адреса почты. Обработчик очереди на такой
-- строке падает с «нет user_id для push» и метит её неотправленной.
-- То есть механика работала вхолостую: за месяц работы салона ни одно
-- предупреждение не дошло бы никому, при том что контроль сроков —
-- ровно то, за что салон платит.
--
-- Push при этом и не мог сработать: OneSignal не подключён. Поэтому
-- канал здесь — почта, а строка ставится на каждого, кто в заведении
-- отвечает за склад. Инспектор исключён намеренно: он приходит
-- на проверку, а не следит за банками.

create or replace function public.enqueue_expiry_warnings(
  p_tenant    uuid,
  p_container uuid,
  p_code      text,
  p_material  text,
  p_use_by    date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_payload jsonb;
begin
  if p_use_by is null then
    return;
  end if;

  v_payload := jsonb_build_object(
    'material', coalesce(p_material, '—'),
    'code',     coalesce(p_code, '—'),
    'use_by',   to_char(p_use_by, 'DD.MM.YYYY'));

  for r in
    select tm.user_id, p.email, coalesce(p.locale, 'uk') as locale
      from public.tenant_members tm
      join public.profiles p on p.id = tm.user_id
     where tm.tenant_id = p_tenant
       and tm.role <> 'inspector'
       and p.email is not null
       and exists (
         select 1 from public.role_grants rg
          where rg.role = tm.role and rg.permission = 'stock.read')
  loop
    -- За 14 дней. Если этот срок уже прошёл — не досылаем задним числом:
    -- предупреждение «за 14 днів» о банке, которой осталось три дня,
    -- дезинформирует.
    if (p_use_by - 14)::timestamptz > now() then
      perform public.enqueue_notification(
        p_tenant, 'cosmetics.expiry_14d', 'email',
        format('container:%s:d14:%s:%s', p_container, p_use_by, r.user_id),
        v_payload, (p_use_by - 14)::timestamptz,
        r.user_id, null, null, r.email, 'container', p_container, r.locale);
    end if;

    -- За 7 дней. Если банку завели, когда до конца срока осталось меньше
    -- недели, предупреждение уходит сразу: молчать о ней до истечения —
    -- худший из вариантов.
    if (p_use_by - 7)::timestamptz > now() then
      perform public.enqueue_notification(
        p_tenant, 'cosmetics.expiry_7d', 'email',
        format('container:%s:d7:%s:%s', p_container, p_use_by, r.user_id),
        v_payload, (p_use_by - 7)::timestamptz,
        r.user_id, null, null, r.email, 'container', p_container, r.locale);
    elsif p_use_by >= current_date then
      perform public.enqueue_notification(
        p_tenant, 'cosmetics.expiry_7d', 'email',
        format('container:%s:d7:%s:%s', p_container, p_use_by, r.user_id),
        v_payload, now(),
        r.user_id, null, null, r.email, 'container', p_container, r.locale);
    end if;
  end loop;
end;
$$;

revoke execute on function public.enqueue_expiry_warnings(uuid, uuid, text, text, date)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Тот же охранник ёмкости из 0014, но с рабочей отправкой
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.containers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pao    int;
  v_expiry date;
  v_name   text;
begin
  -- Факт вскрытия не переписывается и не стирается: это запись журнала,
  -- а не поле настроек. Ошиблись банкой — списывают её и заводят новую.
  if tg_op = 'UPDATE' and old.opened_at is not null
     and new.opened_at is distinct from old.opened_at then
    raise exception 'дата вскрытия не редактируется: ошибочную ёмкость списывают, а не переоткрывают';
  end if;

  if new.status in ('opened') and new.opened_at is null then
    new.opened_at := now();
  end if;
  if new.opened_at is not null and new.opened_by is null then
    new.opened_by := auth.uid();
  end if;
  if new.opened_at is not null and new.status = 'sealed' then
    new.status := 'opened';
  end if;
  if new.status = 'disposed' and new.disposed_at is null then
    new.disposed_at := now();
    new.disposed_by := coalesce(new.disposed_by, auth.uid());
  end if;

  -- use_by: меньшая из дат «срок партии» и «вскрытие + PAO».
  select coalesce(new.pao_months, m.pao_months), m.name
    into v_pao, v_name
    from public.materials m where m.id = new.material_id;
  select b.expiry_date into v_expiry
    from public.material_batches b where b.id = new.batch_id;

  new.use_by := least(
    v_expiry,
    case when new.opened_at is not null and v_pao is not null
         then (new.opened_at + make_interval(months => v_pao))::date
         end
  );

  -- Срок изменился (например, привязали другую партию) — старые
  -- предупреждения с прежней датой больше не верны, гасим.
  if tg_op = 'UPDATE' and new.use_by is distinct from old.use_by then
    update public.notification_outbox
       set status = 'cancelled'
     where ref_type = 'container' and ref_id = new.id and status = 'pending';
  end if;

  if new.use_by is not null and new.status in ('sealed','opened') then
    perform public.enqueue_expiry_warnings(
      new.tenant_id, new.id, new.code, v_name, new.use_by);
  end if;

  -- Списанная/закончившаяся ёмкость гасит свои неотправленные предупреждения.
  if new.status in ('finished','disposed') then
    update public.notification_outbox
       set status = 'cancelled'
     where ref_type = 'container' and ref_id = new.id and status = 'pending';
  end if;

  return new;
end;
$$;

revoke execute on function public.containers_guard() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Артикул в карточке косметики (ТЗ 3.1)
-- ─────────────────────────────────────────────────────────────────────────────
-- Поле требовалось ТЗ и отсутствовало. Уникальность — пер-арендаторная
-- и только среди заполненных: у большинства расходников артикула нет,
-- и заставлять его придумывать нельзя.
alter table public.materials add column if not exists sku text;

create unique index if not exists materials_tenant_sku_uidx
  on public.materials (tenant_id, sku) where sku is not null;

comment on column public.materials.sku is
  'Артикул виробника (ТЗ 3.1). Необовʼязковий: унікальний у межах закладу лише серед заповнених.';
