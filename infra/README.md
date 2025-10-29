# Infra Overview

## Deployment Targets
- **Gateway**: Cloud Run service with auto-scaling (min instances 0, max 20). Containers built via GitHub Actions workflow (`ci/gateway.yml` placeholder).
- **Workers**: Pub/Sub-triggered Cloud Run jobs per provider (`reimagine-worker`, `openai-worker`, `gemini-worker`, `seedream-worker`).
- **Storage**: Supabase buckets for originals and outputs; signed URLs generated server-side with 5-minute TTL.

## Queues & Scheduling
- Cloud Tasks (or Supabase Queue) dispatches heavy edits to workers. Retries capped at 5 with exponential backoff (2^n seconds).
- Low-res previews stored in Redis-like cache (placeholder) with 10-minute expiration; final outputs persisted to storage.

## Secrets & Config
- All provider keys stored in Google Secret Manager; injected at runtime via environment variables.
- Remote config lives in the `provider_routes` table. Toggle providers or update endpoints via the Supabase dashboard (or migrations) instead of editing TypeScript defaults, then call `POST /v1/providers/reload` to fan out changes.

## Observability
- Structured logs exported to Cloud Logging; metrics scraped by managed Prometheus. Errors forwarded to Sentry via OTLP sidecar.
- BigQuery receives daily Supabase export for trend analysis.

## Environments
- `dev`: shared sandbox with relaxed quotas.
- `stage`: mirrors production, used for load and App Review-specific tests.
- `prod`: locked branch deploy, smoke tests must pass before release.
