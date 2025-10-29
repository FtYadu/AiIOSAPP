# Remote Config Playbook

## Table Schema
`provider_routes`
- `id` (UUID, primary key)
- `provider` (text, unique) — aligns with `ModelProvider` cases.
- `endpoint_url` (text) — upstream API base URL.
- `model_id` (text) — default model identifier for the provider.
- `safety_level` (text) — `strict`, `balanced`, `uncensored`.
- `enabled` (boolean) — feature flag for rollout.
- `supports_boxes` (boolean) — exposes masking UI in PromptKit.
- `supports_upscale` (boolean) — toggles the upscale button in CanvasKit.
- `guidance_min` / `guidance_max` (float) — valid range for guidance slider.
- `updated_at` (timestamptz)

## Usage Pattern
1. Gateway and workers request config on boot and cache results for 5 minutes.
2. Calling `POST /v1/providers/reload` forces the cache to invalidate immediately (same hook workers use on TTL expiry).
3. Toggle availability via `enabled`; mobile client respects provider list returned by `/v1/trends` and `/v1/prompt`.
4. Guidance and capability flags flow through to adapters so UI and worker behavior stay aligned.

## Seeding & Drift Control
- Migration `supabase/migrations/002_provider_routes.sql` creates the `provider_routes` table and seeds it with the fallback defaults from `server/src/lib/remoteConfig.ts`.
- Run `supabase db push` (or the corresponding CI workflow) after editing the migration to sync local + hosted Supabase instances.
- For ad-hoc updates, prefer `supabase db diff` to generate follow-up migrations instead of editing SQL in place.
- If you need to repopulate from the TypeScript defaults, run `supabase db reset` to apply migrations from scratch.

## Change Management
- Stage all updates in `dev` environment; validate with contract tests before promoting.
- Document config drift in pull requests and note migrations in this file.
- For emergency shutdown (policy/regression), mark `enabled=false`; gateway returns `503` for that provider.
