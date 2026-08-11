-- 0027_register_tenant_slug_case_fix.sql
-- Восстановлено из боевой базы 11.08.2026 — файла не было в репозитории,
-- хотя миграция применена (version 20260805082800, имя на проде без
-- цифрового префикса: register_tenant_slug_case_fix). См. КОНСПЕКТЫ.md
-- о необходимости сверки git с продом перед следующей миграцией.
--
-- Правит те же грабли, что и 0025, но пропущенные там: порядок lower
-- и translate. Регистр опускается ДО translate/regexp_replace — иначе
-- заглавные буквы имени долетают до regexp_replace как есть и вылетают
-- («Пробник» превращался в «robnyk», первая буква пропадала).

create or replace function public.register_tenant(
  p_name text,
  p_kind public.tenant_kind default 'goods'::public.tenant_kind,
  p_city text default null,
  p_slug extensions.citext default null
)
returns public.tenants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_slug  text;
  v_row   public.tenants;
  v_try   int := 0;
begin
  if v_actor is null then
    raise exception 'реєстрація закладу потребує входу';
  end if;
  if p_name is null or length(btrim(p_name)) < 2 then
    raise exception 'назва закладу занадто коротка';
  end if;

  if (select count(*) from public.tenant_members tm
       join public.tenants t on t.id = tm.tenant_id
      where tm.user_id = v_actor and tm.role = 'owner' and t.status = 'draft') >= 3 then
    raise exception 'у вас уже три неопубліковані заклади — опублікуйте або видаліть їх';
  end if;

  v_slug := coalesce(p_slug::text, regexp_replace(
    translate(lower(btrim(p_name)),
      'абвгґдеєжзиіїйклмнопрстуфхцчшщьюяыэё ',
      'abvggdeezzyiijklmnoprstufhccss__ja__e-'),
    '[^a-z0-9-]', '', 'g'));
  if length(v_slug) < 3 then
    v_slug := 'shop-' || substr(gen_random_uuid()::text, 1, 8);
  end if;
  v_slug := substr(v_slug, 1, 38);

  loop
    begin
      insert into public.tenants (slug, name, kind, city, status)
      values (case when v_try = 0 then v_slug
                   else substr(v_slug, 1, 34) || '-' || substr(gen_random_uuid()::text, 1, 3) end,
              btrim(p_name), p_kind, p_city, 'draft')
      returning * into v_row;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 3 then raise; end if;
    end;
  end loop;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_row.id, v_actor, 'owner');

  return v_row;
end;
$$;

revoke all on function public.register_tenant(text, public.tenant_kind, text, extensions.citext) from public;
revoke all on function public.register_tenant(text, public.tenant_kind, text, extensions.citext) from anon;
grant execute on function public.register_tenant(text, public.tenant_kind, text, extensions.citext) to authenticated;
