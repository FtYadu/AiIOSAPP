# Remote Config Playbook

## Table Schema
`provider_routes`
- `id` (UUID, primary key)
- `provider` (text, unique) — aligns with `ModelProvider` cases.
- `endpoint_url` (text) — upstream API base URL.
- `model_id` (text) — default model identifier for the provider.
- `safety_level` (text) — `strict`, `balanced`, `uncensored`.
- `enabled` (boolean) — feature flag for rollout.
- `updated_at` (timestamptz)

## Usage Pattern
1. Workers request config on boot and cache results for 5 minutes.
2. Gateway includes config version hash in job payloads for traceability.
3. Toggle availability via `enabled`; mobile client respects provider list returned by `/v1/trends` and `/v1/prompt`.

## Change Management
- Stage all updates in `dev` environment; validate with contract tests before promoting.
- Document config drift in pull requests and note migrations in this file.
- For emergency shutdown (policy/regression), mark `enabled=false`; gateway returns `503` for that provider.
