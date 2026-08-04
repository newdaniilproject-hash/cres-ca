-- Заглушки Supabase, которых нет в чистом Postgres
create role anon;
create role authenticated;
create role service_role;
create role supabase_auth_admin;
create schema if not exists auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

-- Заглушка Supabase Vault: в чистом Postgres расширения нет, а миграция
-- 0012 хранит в нём ключи продавцов. Интерфейс совпадает с настоящим —
-- create_secret() и представление decrypted_secrets, — поэтому код
-- миграции тестируется тот же самый, что уходит в бой.
create schema if not exists vault;

create table vault.secrets (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  description text,
  secret      text not null,
  created_at  timestamptz not null default now()
);

create view vault.decrypted_secrets as
  select id, name, description, secret as decrypted_secret, created_at from vault.secrets;

create or replace function vault.create_secret(
  new_secret text, new_name text default null, new_description text default ''
) returns uuid language sql as $$
  insert into vault.secrets (secret, name, description)
  values (new_secret, new_name, new_description) returning id;
$$;

-- Хелперы тестов. Живут в отдельной схеме, чтобы не путались с прикладными.
create schema if not exists test;
