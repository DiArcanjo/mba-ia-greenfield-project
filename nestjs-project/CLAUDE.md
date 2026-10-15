# CLAUDE.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, etc.) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`
- **Redis:** `docker compose exec redis redis-cli ping` — expect `PONG`
- **MinIO bucket:** `docker compose logs minio-init` — expect `Bucket created successfully` (or already exists); the one-shot container exits with code `0`

The `video-worker` container must be up (`docker compose up -d video-worker`) for the video e2e tests: they use the real worker and do not replace it.

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start containers
docker compose up -d

# Install dependencies (first time only)
docker compose exec nestjs-api npm install

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev
```

Services:
- `nestjs-api` — NestJS API, port `3000`
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`
- `minio` — S3-compatible object storage (Chainguard image `cgr.dev/chainguard/minio`, since MinIO no longer publishes public images), API `9000`, console `9001`; bucket `streamtube-videos` is created by the one-shot `minio-init`
- `redis` — Redis 7, port `6379` (BullMQ broker)
- `video-worker` — BullMQ/FFmpeg worker, same image as `nestjs-api` (FFmpeg/ffprobe installed in `Dockerfile.dev`)

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube

# Check container logs
docker compose logs nestjs-api
docker compose logs db

# Tear down the entire environment
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

## Videos (upload, processing and delivery)

Phase 03 added the video pipeline. Everything below exists in `src/`; the module list, routes, scripts and variables were checked against the code.

### Modules

| Module (dir) | Responsibility |
|---|---|
| `videos` (`VideosModule`) | `Video` entity, `VideosService` (ownership lookup and conditional status transitions), `VideoUploadsService` (multipart handshake), `VideoDeliveryService` (presigned stream/download/thumbnail URLs), `VideoProcessingProducer` (enqueues jobs), `VideoUploadsController` and `VideosController`, `public-id.util.ts` |
| `storage` (`StorageModule`) | Only place that knows the AWS SDK: `StorageService` (multipart, presign, head/put/delete) and `STORAGE_KEYS` in `storage.constants.ts` |
| `queue` (`QueueModule`) | Shared BullMQ/Redis connection and key prefix (`BullModule.forRootAsync`), used by API and worker |
| `media` (`MediaModule`) | `MediaToolsService`: `ffprobe`/`ffmpeg` over a presigned URL; failures are `MediaProcessingError` with `retryable` |
| `video-processing` (`VideoProcessingModule`) | `VideoProcessingService` (probe, thumbnail, `ready`) and `VideoProcessingProcessor` (BullMQ consumer); loaded only by the worker, never by the API |
| `worker` (`WorkerModule`) | Root module of the worker process, no controllers; entrypoint `src/worker.ts` |
| `core` (`CoreModule`) | Global `ConfigModule.forRoot` (all config namespaces + Joi validation) and `TypeOrmModule.forRootAsync`, shared by `AppModule` and `WorkerModule` |

Config namespaces: `storage.config.ts`, `queue.config.ts`, `video.config.ts` (in `src/config/`).

### Endpoints

All require a Bearer access token; only the video's owner (the channel's user) has access, anyone else gets `404 VIDEO_NOT_FOUND`. Routes use the 11-character `publicId`; the internal uuid is never exposed.

| Method and route | Purpose |
|---|---|
| `POST /videos` | Creates the draft and opens the multipart upload (`201`) |
| `POST /videos/:publicId/upload/parts` | Presigned `PUT` URLs for the requested part numbers (`200`) |
| `GET /videos/:publicId/upload` | Parts already stored, for resuming (`200`) |
| `POST /videos/:publicId/upload/complete` | Completes the multipart, checks size, enqueues processing; idempotent (`202`) |
| `GET /videos/:publicId` | Video data and status (`200`) |
| `GET /videos/:publicId/stream` | `302` to a presigned URL that serves `Range`/`206` |
| `GET /videos/:publicId/download` | `302` to a presigned URL with `Content-Disposition: attachment` |
| `GET /videos/:publicId/thumbnail` | `302` to the presigned JPEG |

### Upload flow

1. `POST /videos` with `{ filename, contentType, size }` returns `publicId` and `upload: { uploadId, partSize, partCount }` (`partCount = ceil(size / partSize)`; `size` above `VIDEO_MAX_SIZE_BYTES` is `413`).
2. `POST .../upload/parts` with `{ partNumbers }`, then `PUT` each part's bytes to its URL directly in the storage (the API never receives the bytes) and read the `ETag` response header.
3. `POST .../upload/complete` with `{ parts: [{ partNumber, etag }] }` covering exactly `1..partCount`. The API completes the multipart, compares the object's `ContentLength` with `size_bytes` (mismatch: object deleted, video `failed`, `422 UPLOAD_SIZE_MISMATCH`), moves the video to `processing` and enqueues the job. Repeating the call returns the current status.
4. Poll `GET /videos/:publicId` until `processingStatus` is `ready` or `failed`.

Manual request collection: `api.http` (section VÍDEOS). Contract: `openapi.json` (`npm run openapi:export`).

### Status lifecycle

`processing_status`: `uploading` -> `processing` -> `ready` | `failed` (`failure_reason` holds the cause). Transitions are conditional updates (`UPDATE ... WHERE processing_status = :expected`) in `VideosService`, which makes `complete` and the worker idempotent. `publication_status` is independent and is always `draft` in this phase. Error codes: `VIDEO_NOT_FOUND`, `CHANNEL_NOT_FOUND`, `VIDEO_TOO_LARGE`, `INVALID_UPLOAD_STATE`, `INVALID_UPLOAD_PARTS`, `UPLOAD_SIZE_MISMATCH`, `VIDEO_NOT_READY` (`src/common/exceptions/domain.exception.ts`).

### Queue and worker

- Queue `video-processing`, job `process-video` with payload `{ videoId }` (`src/videos/video-processing.constants.ts`). `jobId` is the video's internal id, so enqueueing twice keeps one job.
- Retries: `VIDEO_PROCESSING_ATTEMPTS` attempts with exponential backoff starting at `VIDEO_PROCESSING_BACKOFF_MS`. A non-retryable media error (not a video) becomes a BullMQ `UnrecoverableError` and fails immediately; on that or when attempts are exhausted the processor marks the video `failed`.
- `MediaProcessingError` messages never contain URLs: the presigned input URL (with its signature) is replaced by `<input>`, because the message ends up in logs and in `failure_reason`, which `GET /videos/:publicId` returns.
- Worker: Compose service `video-worker` (same image as `nestjs-api`, FFmpeg installed in `Dockerfile.dev`), command `npm run start:worker:dev` (`nest start --watch --entryFile worker`). Production script: `npm run start:worker` (`node dist/worker`); `npm run build` emits both `dist/main.js` and `dist/worker.js`. It is a Nest application context and opens no HTTP port.
- `@nestjs/bullmq` and `@nestjs/bull-shared` are ESM-only; the Jest configs (`package.json` and `test/jest-e2e.json`) carry a `ts-jest` transform and `transformIgnorePatterns` for them. The Nest build (CommonJS) loads them through Node's `require(esm)`.

### Storage

- Bucket `streamtube-videos` (`S3_BUCKET`), created by the one-shot `minio-init` service. Keys: `videos/{id}/original` and `videos/{id}/thumbnail.jpg`, where `{id}` is the internal uuid (`STORAGE_KEYS`).
- Two S3 clients with the same credentials: `S3_ENDPOINT` (internal, `http://minio:9000`) for the API/worker operations and `S3_PUBLIC_ENDPOINT` for presigning, because the signed host must be reachable by whoever uses the URL. Both default to `http://minio:9000`, which works for tests inside the Compose network; a browser client needs `S3_PUBLIC_ENDPOINT` overridden (for example `http://localhost:9000`).
- `forcePathStyle` is on, as MinIO requires. Presign clients use `requestChecksumCalculation: 'WHEN_REQUIRED'` so presigned part URLs stay valid for plain HTTP `PUT`s.
- MinIO does not support the `AbortIncompleteMultipartUpload` lifecycle action; `minio-init` sets `stale_uploads_expiry=24h` and `stale_uploads_cleanup_interval=6h` instead. On real S3, apply the lifecycle rule.

### Environment variables

`S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (required), `S3_BUCKET`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` (Compose), `REDIS_HOST`, `REDIS_PORT`, `QUEUE_PREFIX`, `VIDEO_PROCESSING_ATTEMPTS`, `VIDEO_PROCESSING_BACKOFF_MS`, `VIDEO_MAX_SIZE_BYTES`, `VIDEO_PART_SIZE_BYTES` (minimum 5 MiB), `VIDEO_PART_URL_TTL_SECONDS`, `VIDEO_STREAM_URL_TTL_SECONDS`. Defaults and validation: `src/config/env.validation.ts`; examples: `.env.example`.

### Verifying the video services

```bash
docker compose ps                                    # minio, redis, video-worker running; minio-init exited 0
docker compose exec redis redis-cli ping             # PONG
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9000/minio/health/live   # 200
docker compose logs minio-init                       # bucket created, settings applied
docker compose logs video-worker                     # worker booted, no errors
docker compose exec nestjs-api ffprobe -version      # FFmpeg available in the shared image
```

### Testing notes

- E2E suites (`test/videos-*.e2e-spec.ts`) use the real MinIO, Redis and the Compose `video-worker`; the worker must be up. `npm run test:e2e` already runs with `--runInBand`.
- Integration tests that touch the queue set a unique `QUEUE_PREFIX` so the Compose worker does not consume their jobs.
- Test helpers: `src/test/video-flow.ts` (app bootstrap, register/login, upload flow, `waitForProcessing`, `createReadyVideo`), `src/test/storage.ts`, `src/test/generate-test-video.ts` (real ffmpeg-generated MP4).

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process. `DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.
