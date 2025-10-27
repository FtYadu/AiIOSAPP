# Repository Guidelines

This document aligns new contributors around the hybrid iOS + backend stack that powers the Imagen editing hub. Keep changes focused, documented, and easy to review.

## Project Structure & Module Organization
- `ios/`: SwiftUI + Metal app. Submodules mirror feature kits (CaptureKit, CanvasKit, PromptKit, ModelKit, CompareKit, LibraryKit, ShareKit, InspirationKit).
- `server/`: API gateway (TypeScript/Node) with provider workers (`reimagine-worker`, `openai-worker`, `gemini-worker`, `seedream-worker`).
- `infra/`: IaC, queuing, and observability configs (Cloud Run, Pub/Sub, Supabase).
- `docs/`: Product specs, prompt heuristics, and provider notes.
- `assets/`: Sample images, prompt recipes, UI snapshots (non-prod PII only).

## Build, Test, and Development Commands
- iOS preview: `cd ios && xcodebuild -scheme ImagenDev -destination 'platform=iOS Simulator,name=iPhone 15' build`
- iOS tests: `cd ios && fastlane test` for XCTest + snapshot runs.
- Gateway dev server: `cd server && npm run dev` launches local API with mock storage.
- Worker tests: `cd server && npm run test -- provider` executes targeted Jest suites.
- Lint all: `cd server && npm run lint && swiftlint --strict` to keep both tiers clean.
- Queue tests locally (optional): run `npm run worker` in a separate shell with RabbitMQ running and `RABBITMQ_URL=amqp://localhost` to consume real tasks.

## Coding Style & Naming Conventions
- Swift: 4-space indentation, `camelCase` for vars/functions, `UpperCamelCase` for types; prefer protocol-oriented APIs for canvas and model routing.
- TypeScript: 2-space indentation, ES modules, `PascalCase` classes, `camelCase` functions; enforce explicit return types on exported functions.
- Commit to formatter defaults (`swift-format`, `prettier`) before pushing; no hand-edited generated files.

## Testing Guidelines
- SwiftUI + Metal: XCTest for view models, snapshot tests for CanvasKit, and Metal shader unit tests via `MetalPerformanceShadersGraph`.
- Server: Jest + supertest for REST surfaces, contract fixtures per provider, minimum 80% statement coverage (`npm run test -- --coverage`).
- Name test files `<Target>Tests.swift` and `<module>.spec.ts`; place fixtures under `server/testdata/`.

## Commit & Pull Request Guidelines
- Use Conventional Commits (`feat:`, `fix:`, `chore:`); keep scope aligned with module names (e.g., `feat(canvas)`).
- PR checklist: problem summary, solution notes, test evidence (`✅ npm test`, `✅ fastlane test`), screenshots or before/after images for UI changes, linked Linear/Jira ticket.
- Request review from the owning kit lead (Canvas, Prompt, Gateway) and tag providers touched for worker edits.

## Security & Configuration Tips
- Store provider credentials in the gateway KMS; reference via `SERVER_CONFIG` secrets, never in code.
- Use Remote Config tables for provider endpoints, model names, safety flags; document migrations in `docs/remote-config.md`.
- Verify new provider integrations against abuse quotas before enabling in production stage.
- Additional env vars: `RABBITMQ_URL`, `RABBITMQ_QUEUE` (defaults to `my-tasks`) for message dispatch; `DATABASE_URL`, `S3_*` for Neon/MinIO.
- Required env keys (or secret manager entries): `OPENAI_API_KEY`, `GEMINI_API_KEY`, `SEEDREAM_API_KEY`, `SEEDREAM_ENDPOINT`, optional `SEEDREAM_MODEL_ID`, `REIMAGINE_API_KEY`.
