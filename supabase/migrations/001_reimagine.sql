-- Providers registry controls routing and weighting between upstream models
create table if not exists public.providers (
  key text primary key,
  enabled boolean not null default true,
  weight int not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.image_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null check (status in ('queued','running','succeeded','failed')),
  prompt text not null,
  strength float4 default 0.7,
  guidance float4 default 7.5,
  seed bigint,
  size text default '1024x1024',
  output_format text default 'png',
  n int default 1 check (n between 1 and 4),
  provider text references public.providers(key),
  init_image_url text,
  mask_url text,
  error text,
  metadata jsonb default '{}'::jsonb,
  webhook_url text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists image_jobs_user_idempotency
  on public.image_jobs(user_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.image_assets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.image_jobs(id) on delete cascade,
  kind text not null check (kind in ('init','mask','output')),
  storage_path text not null,
  public_url text,
  mime text,
  width int,
  height int,
  sha256 text,
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.image_jobs(id) on delete cascade,
  target_url text not null,
  status int,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_image_jobs_updated on public.image_jobs;
create trigger trg_image_jobs_updated
before update on public.image_jobs
for each row execute function public.touch_updated_at();

alter table public.image_jobs enable row level security;
alter table public.image_assets enable row level security;
alter table public.webhook_events enable row level security;
alter table public.providers enable row level security;

drop policy if exists "user-can-select-own-jobs" on public.image_jobs;
create policy "user-can-select-own-jobs"
on public.image_jobs for select
using (auth.uid() = user_id);

drop policy if exists "user-can-insert-own-jobs" on public.image_jobs;
create policy "user-can-insert-own-jobs"
on public.image_jobs for insert
with check (auth.uid() = user_id);

drop policy if exists "user-can-select-own-assets" on public.image_assets;
create policy "user-can-select-own-assets"
on public.image_assets for select
using (
  exists(select 1 from public.image_jobs j where j.id = image_assets.job_id and j.user_id = auth.uid())
);

drop policy if exists "user-cannot-read-providers" on public.providers;
create policy "user-cannot-read-providers"
on public.providers for select
using (false);
