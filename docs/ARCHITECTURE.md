# Architecture Overview

## Client (iOS)
- Swift Package with feature modules (`CaptureKit`, `CanvasKit`, `PromptKit`, `ModelKit`, `CompareKit`, `LibraryKit`, `ShareKit`, `InspirationKit`) consumed by the executable target `ImagenApp`.
- `CanvasKit` wraps the Metal-capable canvas, annotation boxes, and real-time state via `CanvasViewModel`.
- `ModelKit` exposes `ModelRouter`, an observable job tracker that speaks to the gateway.
- `PromptKit` contains `PromptAssistant` for ChatKit-backed suggestions and heuristics.
- `ShareKit` and `LibraryKit` provide export and asset cache abstractions used in the UI layer.

## Backend (Gateway + Workers)
- Express application (`server/src/app.ts`) normalizes routes under `/v1/*` and delegates provider-specific logic via the registry in `src/providers/providerRegistry.ts`.
- Providers implement the `ProviderAdapter` contract (`src/providers/types.ts`), enabling dynamic swapping (Reimagine, OpenAI, Gemini, Seedream).
- `jobRepository` (`src/lib/jobRepository.ts`) reads/writes Neon Postgres rows for jobs, assets, and idempotency.
- `queueClient` (`src/lib/queueClient.ts`) dispatches jobs via RabbitMQ (falling back to in-memory during tests) and defers execution to a worker.
- `workers/rabbitWorker.ts` consumes the RabbitMQ queue, runs provider executors, persists outputs, and supports standalone deployment.
- Dedicated worker harness (`src/workers/providerWorker.ts`) illustrates the async execution pattern for queue triggered jobs.
- Provider executors (`src/providers/executors/*`) wrap official APIs for OpenAI Images, Gemini generateContent, and Seedream responses.

## Storage & Telemetry
- Remote config, Supabase, and storage bindings are represented through environment values (`src/config/env.ts`) and dependency-injected into providers.
- Observability hooks rely on `pino-http` for structured logs; metrics exporters attach at the server layer.
- In-memory metrics buffer (`src/lib/metrics.ts`) captures key counters (enqueue/fetch) ready for Prometheus export.
- Required provider env vars live in `server/.env` (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `SEEDREAM_API_KEY`, `SEEDREAM_ENDPOINT`, optional `SEEDREAM_MODEL_ID`, `REIMAGINE_API_KEY`).

## Development Workflow
- iOS preview builds go through SwiftPM / Xcode using the `ImagenApp` executable target.
- Gateway uses `tsx` for hot reload (`npm run dev`) and Jest for contract tests (`server/tests`). Swift targets use `swift test` via GitHub Actions (`.github/workflows/ci.yml`).
- Shared docs (`docs/`) capture provider guides and remote config expectations. `infra/` retains deployment descriptors for Cloud Run + Pub/Sub queues.
