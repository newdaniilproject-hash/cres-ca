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

-- Сеансы. Настоящую `auth.sessions` держит Supabase; на стенде её не было,
-- и миграция 0076 (принудительный выход, список активных сеансов) на нём
-- не применялась вовсе. Колонки повторяют боевые ровно в той части,
-- которую читает и чистит наш код, — чтобы проверялся тот же текст
-- миграции, а не его пересказ.
create table if not exists auth.sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  not_after    timestamptz,
  refreshed_at timestamp,
  user_agent   text,
  ip           inet
);

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

-- Заглушка Supabase Storage: схемы storage в чистом Postgres нет, а миграция
-- 0019 заводит в ней два бакета и восемь политик. Без заглушки прогон падал
-- на 0019 сразу после 0018 — то есть обязательный шлюз «правка миграций
-- прогоняется через run.sh» не доходил до тестов вообще.
--
-- Колонки повторяют настоящие ровно в той части, которую трогает 0019:
-- buckets(id, name, public, file_size_limit, allowed_mime_types) и
-- objects(bucket_id, name, owner). Больше не нужно — проверяется разбор
-- политик и функция storage_tenant(), а не работа самого хранилища.
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text not null,
  owner      uuid,
  created_at timestamptz not null default now(),
  metadata   jsonb
);

alter table storage.objects enable row level security;
