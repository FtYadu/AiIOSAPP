-- Provider routing metadata exposed via Supabase remote config
create extension if not exists "pgcrypto";

create table if not exists public.provider_routes (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique,
  endpoint_url text not null,
  model_id text not null,
  safety_level text not null check (safety_level in ('strict', 'balanced', 'uncensored')),
  enabled boolean not null default true,
  supports_boxes boolean not null default false,
  supports_upscale boolean not null default false,
  guidance_min real not null default 0,
  guidance_max real not null default 1,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_provider_routes_updated on public.provider_routes;
create trigger trg_provider_routes_updated
before update on public.provider_routes
for each row execute function public.touch_updated_at();

alter table public.provider_routes enable row level security;

drop policy if exists "service-role-read-write-provider-routes" on public.provider_routes;
create policy "service-role-read-write-provider-routes"
on public.provider_routes
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

insert into public.provider_routes (
  provider,
  endpoint_url,
  model_id,
  safety_level,
  enabled,
  supports_boxes,
  supports_upscale,
  guidance_min,
  guidance_max
)
values
  (
    'reimagine',
    'https://api.reimagine.local/v1',
    'reimagine-edit-latest',
    'uncensored',
    true,
    true,
    true,
    0,
    1
  ),
  (
    'openai',
    'https://api.openai.com/v1',
    'gpt-image-edit-1',
    'balanced',
    true,
    true,
    false,
    0,
    1
  ),
  (
    'gemini',
    'https://generativelanguage.googleapis.com/v1beta',
    'gemini-image-edit-1',
    'strict',
    true,
    false,
    false,
    0,
    1
  ),
  (
    'seedream',
    'https://api.seedream.ai/v1',
    'seedream-edit-4.0',
    'balanced',
    true,
    true,
    true,
    0,
    1
  )
on conflict (provider) do update set
  endpoint_url = excluded.endpoint_url,
  model_id = excluded.model_id,
  safety_level = excluded.safety_level,
  enabled = excluded.enabled,
  supports_boxes = excluded.supports_boxes,
  supports_upscale = excluded.supports_upscale,
  guidance_min = excluded.guidance_min,
  guidance_max = excluded.guidance_max,
  updated_at = now();
