-- Enable required extensions
create extension if not exists "pgcrypto";

create table if not exists providers (
  key text primary key,
  enabled boolean not null default true,
  weight integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists image_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null check (status in ('queued','running','succeeded','failed')),
  prompt text not null,
  strength real default 0.7,
  guidance real default 7.5,
  seed bigint,
  size text default '1024x1024',
  output_format text default 'png',
  n integer default 1 check (n between 1 and 4),
  provider text references providers(key),
  init_image_url text,
  mask_url text,
  error text,
  metadata jsonb default '{}'::jsonb,
  webhook_url text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_image_jobs_user_idempotency
  on image_jobs(user_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists image_assets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references image_jobs(id) on delete cascade,
  kind text not null check (kind in ('init','mask','output')),
  storage_path text not null,
  public_url text,
  mime text,
  width integer,
  height integer,
  sha256 text,
  created_at timestamptz not null default now()
);

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references image_jobs(id) on delete cascade,
  target_url text not null,
  status integer,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_image_jobs_updated on image_jobs;
create trigger trg_image_jobs_updated
before update on image_jobs
for each row execute function touch_updated_at();
