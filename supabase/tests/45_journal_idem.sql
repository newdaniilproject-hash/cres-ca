-- 45. Ключ ідемпотентності санітарних журналів (0128).
--
-- Перевіряється СПРОБА порушення, а не наявність індексу: індекс може
-- існувати і не покривати той стовпець, за яким іде досилка з черги.
--
-- Сценарій, заради якого це заведено: майстер відмічає дезінфекцію,
-- транзакція комітиться, відповідь не доїжджає, клієнт кладе дію в чергу
-- і досилає її знову. Без ключа в НЕЗМІНЮВАНОМУ журналі назавжди лишається
-- другий рядок «виконано двічі о 14:32».

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('45000000-0000-0000-0000-000000000001', 'idem@test');

insert into public.tenants (id, slug, name, status, kind)
values ('45000000-0000-0000-0000-0000000000aa', 'idem-shop', 'Ідем', 'active', 'services');

insert into public.cleaning_tasks (id, tenant_id, name, position)
values ('45000000-0000-0000-0000-0000000000bb',
        '45000000-0000-0000-0000-0000000000aa', 'Дезінфекція поверхні', 1);

\echo '--- 0128: повтор того самого ключа відхиляється'
do $$
declare v_failed boolean := false;
begin
  insert into public.cleaning_entries
    (tenant_id, task_id, performed_by, performed_at, idempotency_key)
  values ('45000000-0000-0000-0000-0000000000aa',
          '45000000-0000-0000-0000-0000000000bb',
          '45000000-0000-0000-0000-000000000001', now(), 'k-1');

  begin
    insert into public.cleaning_entries
      (tenant_id, task_id, performed_by, performed_at, idempotency_key)
    values ('45000000-0000-0000-0000-0000000000aa',
            '45000000-0000-0000-0000-0000000000bb',
            '45000000-0000-0000-0000-000000000001', now(), 'k-1');
  exception when unique_violation then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'ПРОВАЛ: досилка з тим самим ключем подвоїла запис журналу';
  end if;
  raise notice 'ok — повтор ключа відхилено';
end;
$$;

\echo '--- 0128: різні ключі і порожні ключі не конфліктують'
do $$
begin
  -- Другий ключ — це друга справжня дія, вона проходити зобовʼязана.
  insert into public.cleaning_entries
    (tenant_id, task_id, performed_by, performed_at, idempotency_key)
  values ('45000000-0000-0000-0000-0000000000aa',
          '45000000-0000-0000-0000-0000000000bb',
          '45000000-0000-0000-0000-000000000001', now(), 'k-2');

  -- Без ключа пишуть онлайн і старі версії застосунку. Індекс частковий
  -- саме тому: два порожні ключі — це два різні рядки, а не конфлікт.
  insert into public.cleaning_entries (tenant_id, task_id, performed_by, performed_at)
  values ('45000000-0000-0000-0000-0000000000aa',
          '45000000-0000-0000-0000-0000000000bb',
          '45000000-0000-0000-0000-000000000001', now()),
         ('45000000-0000-0000-0000-0000000000aa',
          '45000000-0000-0000-0000-0000000000bb',
          '45000000-0000-0000-0000-000000000001', now());

  if (select count(*) from public.cleaning_entries
       where tenant_id = '45000000-0000-0000-0000-0000000000aa') <> 4 then
    raise exception 'ПРОВАЛ: очікували 4 рядки (k-1, k-2 і два без ключа)';
  end if;
  raise notice 'ok — різні ключі й порожні ключі проходять';
end;
$$;

\echo '--- 0128: ключ ізольований орендарем'
do $$
begin
  insert into auth.users (id, email) values
    ('45000000-0000-0000-0000-000000000002', 'idem2@test');
  insert into public.tenants (id, slug, name, status, kind)
  values ('45000000-0000-0000-0000-0000000000cc', 'idem-shop-2', 'Ідем 2', 'active', 'services');
  insert into public.cleaning_tasks (id, tenant_id, name, position)
  values ('45000000-0000-0000-0000-0000000000dd',
          '45000000-0000-0000-0000-0000000000cc', 'Дезінфекція поверхні', 1);

  -- ТОЙ САМИЙ ключ в іншому закладі — це інша дія іншого салону.
  -- Глобальна унікальність зробила б чужу відмітку причиною відмови,
  -- і побачив би це той заклад, який завів систему другим.
  insert into public.cleaning_entries
    (tenant_id, task_id, performed_by, performed_at, idempotency_key)
  values ('45000000-0000-0000-0000-0000000000cc',
          '45000000-0000-0000-0000-0000000000dd',
          '45000000-0000-0000-0000-000000000002', now(), 'k-1');
  raise notice 'ok — той самий ключ в іншому закладі проходить';
end;
$$;

\echo '--- 0128: те саме на розчинах і стерилізації'
do $$
declare v_failed boolean := false;
begin
  insert into public.sanitation_solutions
    (tenant_id, agent_name, concentration, volume, unit, prepared_by, expires_at, idempotency_key)
  values ('45000000-0000-0000-0000-0000000000aa', 'Дезактин', '0,2 %', 5, 'л',
          '45000000-0000-0000-0000-000000000001', now() + interval '24 hours', 's-1');
  begin
    insert into public.sanitation_solutions
      (tenant_id, agent_name, concentration, volume, unit, prepared_by, expires_at, idempotency_key)
    values ('45000000-0000-0000-0000-0000000000aa', 'Дезактин', '0,2 %', 5, 'л',
            '45000000-0000-0000-0000-000000000001', now() + interval '24 hours', 's-1');
  exception when unique_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'ПРОВАЛ: розчин подвоївся'; end if;

  v_failed := false;
  insert into public.sterilization_cycles
    (tenant_id, device, temperature_c, duration_minutes, indicator_ok, performed_by, idempotency_key)
  values ('45000000-0000-0000-0000-0000000000aa', 'сухожарова шафа', 180, 60, true,
          '45000000-0000-0000-0000-000000000001', 'c-1');
  begin
    insert into public.sterilization_cycles
      (tenant_id, device, temperature_c, duration_minutes, indicator_ok, performed_by, idempotency_key)
    values ('45000000-0000-0000-0000-0000000000aa', 'сухожарова шафа', 180, 60, true,
            '45000000-0000-0000-0000-000000000001', 'c-1');
  exception when unique_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'ПРОВАЛ: цикл стерилізації подвоївся'; end if;

  raise notice 'ok — розчини і стерилізація захищені так само';
end;
$$;

rollback;
