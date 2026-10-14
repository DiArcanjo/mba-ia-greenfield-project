# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 21/24 completed

### SI-03.1 — Infra: MinIO, Redis, worker e FFmpeg no Docker Compose
- **Status:** completed
- **Tests:** no tests (infra); ACs verified manually (services listed, minio/redis healthy, minio-init exit 0 with bucket created, PONG, ffprobe ok)
- **Observations:**
  - Image origin changed per user decision: MinIO no longer publishes public images (Docker Hub `minio/minio` and `minio/mc` fail to pull), so `cgr.dev/chainguard/minio:latest` and `cgr.dev/chainguard/minio-client:latest` (Chainguard packaging of the same MinIO) are used. TD-03 unchanged (still S3-compatible MinIO).
  - Chainguard images have no `/bin/sh`/curl: minio healthcheck uses bash `/dev/tcp` against `/minio/health/live`; `minio-init` entrypoint is `/usr/bin/bash -c`.
  - `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` added to `.env` (gitignored) with compose defaults; `.env.example` is updated in SI-03.2.
  - **Review adjustment (lifecycle for abandoned multipart uploads, TD-08 Note):** an `AbortIncompleteMultipartUpload` bucket rule (`mc ilm rule import` with `DaysAfterInitiation: 1`) cannot be applied: MinIO rejects it with `InvalidArgument` (verified against the running server; the MinIO S3-compatibility docs state the action is not supported by `PutBucketLifecycle`). `minio-init` instead pins MinIO's native equivalent, `mc admin config set local api stale_uploads_expiry=24h stale_uploads_cleanup_interval=6h`, verified with `mc admin config get local api`. Same intent (abandoned parts removed after ~1 day) but implemented as a server setting, not a bucket rule; on real S3 the lifecycle rule should be applied instead.

### SI-03.2 — Dependências e namespaces de configuração (storage, fila, vídeo)
- **Status:** completed
- **Tests:** 12 passing in src/config (7 new in env.validation.integration-spec.ts); tsc clean; lint 0 errors
- **Observations:**
  - `S3_ACCESS_KEY`/`S3_SECRET_KEY` are now required by the Joi schema, so the existing `requiredEnv` fixture in `env.validation.integration-spec.ts` was extended with them.
  - `.env` (gitignored) updated with all new vars; `MINIO_ROOT_*` also added to `.env.example`.

### SI-03.3 — StorageModule: cliente S3/MinIO e operações de objeto
- **Status:** completed
- **Tests:** 7 passing (6 integration against real MinIO + 1 module unit); tsc clean; lint 0 errors
- **Observations:**
  - S3 clients are created with `requestChecksumCalculation/responseChecksumValidation: 'WHEN_REQUIRED'` so presigned UploadPart URLs carry no flexible-checksum params and work with plain HTTP PUTs (SDK v3 default would add them).
  - `listParts` of an aborted upload rejects (NoSuchUpload); tested accordingly.

### SI-03.4 — Entidade Video, migration e VideosModule base
- **Status:** completed
- **Tests:** 6 entity integration + 1 module unit + migrations spec (updated, 3 migrations, revert/reapply of videos); full suite 157 passing, e2e 52 passing, tsc clean, lint 0 errors
- **Observations:**
  - `Video` added to the `ALL_ENTITIES` arrays of existing specs (the new `Channel.videos` relation requires it in every test DataSource).
  - `VideosModule` imported in `AppModule` so the entity is auto-loaded.
  - `Video` entity has no `@Index` on `public_id` besides the unique constraint (the unique already indexes it).

### SI-03.5 — Gerador de id público do vídeo
- **Status:** completed
- **Tests:** 3 passing (public-id.util.spec.ts)
- **Observations:** none

### SI-03.6 — Exceções de domínio de vídeo e busca de canal por usuário
- **Status:** completed
- **Tests:** 7 new filter cases + 2 findByUserId integration; src/common|channels|videos 52 passing; tsc clean; lint 0 errors
- **Observations:** none

### SI-03.7 — QueueModule e producer da fila de processamento
- **Status:** completed
- **Tests:** 4 new (3 producer integration vs real Redis + 1 QueueModule unit); full suite 180 passing, e2e 52 passing; tsc clean; lint 0 errors
- **Observations:**
  - `@nestjs/bullmq@12` and `@nestjs/bull-shared` are ESM-only (`"type": "module"`), which Jest (CommonJS) cannot load. Added a ts-jest transform for those two packages plus `transformIgnorePatterns` to `package.json` (jest) and `test/jest-e2e.json`. Runtime under Nest build (CJS on Node 25) must be re-checked in SI-03.22 (`npm run build` + worker entrypoint).
  - `bullmq@6` no longer bundles Redis client: `ioredis@^5.11.1` installed (optional peer, required at runtime; the plan did not list it).
  - `VideosModule` now needs `ConfigModule` (global) + `QueueModule` in any test module; `videos.module.spec.ts` updated.

### SI-03.8 — VideosService: posse, transições de status e DTO de resposta
- **Status:** completed
- **Tests:** 20 new across videos.service.spec.ts, videos.service.integration-spec.ts, video-response.dto.spec.ts; full suite 200 passing in 33 suites, e2e 52 passing; tsc clean; lint 0 errors
- **Observations:** none

### SI-03.9 — Início do upload: pré-cadastro do rascunho e sessão multipart
- **Status:** completed
- **Tests:** 9 new (6 unit + 3 integration vs PostgreSQL+MinIO); full suite 209 passing, e2e 52; tsc clean; lint 0 errors
- **Observations:**
  - Importing StorageModule/ChannelsModule into VideosModule means every test module that loads VideosModule must also load storageConfig and videoConfig (videos.module.spec and producer integration spec updated).

### SI-03.10 — Handshake de upload: URLs de partes, retomada e conclusão
- **Status:** completed
- **Tests:** 20 new (19 unit + 4 integration vs PostgreSQL+MinIO+Redis); full suite green; tsc clean; lint 0 errors
- **Observations:** none

### SI-03.11 — Endpoint POST /videos
- **Status:** completed
- **Tests:** 5 e2e passing (test/videos-initiate-upload.e2e-spec.ts, authored from specs/videos-initiate-upload.plan.md); unit suite 248 passing, e2e 57 passing; tsc clean; lint 0 errors
- **Observations:**
  - Created src/test/video-flow.ts (app bootstrap, register/login, initiate/upload/complete/wait helpers) earlier than SI-03.23 because the endpoint e2e specs of SI-03.11..19 depend on it; SI-03.23 should extend it rather than recreate it.
  - Added --runInBand to the test:e2e script: e2e suites share one database and run in parallel by default, which made suites collide as soon as a 4th e2e file existed (project CLAUDE.md requires --runInBand).

### SI-03.12 — Endpoint POST /videos/:publicId/upload/parts
- **Status:** completed
- **Tests:** 6 e2e passing (test/videos-upload-parts.e2e-spec.ts); unit suite 261 passing, e2e 63 passing; tsc clean; lint 0 errors
- **Observations:**
  - Scenario 1.5 (rejects-video-in-processing) puts the video in 'processing' with a direct UPDATE instead of the upload+complete flow, because POST .../upload/complete is only implemented in SI-03.14; the asserted behavior (409 INVALID_UPLOAD_STATE) is identical. Could be switched to the helper flow later.
  - Changed video-flow.completeUpload to return a supertest Test (chainable .expect).

### SI-03.13 — Endpoint GET /videos/:publicId/upload
- **Status:** completed
- **Tests:** 5 e2e passing (test/videos-upload-status.e2e-spec.ts); unit suite 261 passing, e2e 68 passing; tsc clean; lint 0 errors
- **Observations:**
  - Scenario 1.3 (rejects-video-in-processing) also drives the processing state via a direct UPDATE until SI-03.14 exists (same as SI-03.12).

### SI-03.14 — Endpoint POST /videos/:publicId/upload/complete
- **Status:** completed
- **Tests:** 7 e2e passing (test/videos-upload-complete.e2e-spec.ts); unit suite 261 passing, e2e 75 passing; tsc clean; lint 0 errors
- **Observations:**
  - Scenario 1.1 accepts processing
  - ready
  - failed in the 202 body: the video-worker entrypoint does not exist until SI-03.22, and the test uploads zero bytes (not a valid video), so only the 202 contract is asserted here; end-to-end processing is covered by SI-03.23.

### SI-03.15 — VideoDeliveryService: URLs de streaming, download e thumbnail
- **Status:** completed
- **Tests:** 14 passing (8 unit + 6 integration vs PostgreSQL+MinIO); full suite green; tsc clean; lint 0 errors
- **Observations:** none

### SI-03.16 — Endpoint GET /videos/:publicId
- **Status:** completed
- **Tests:** 5 e2e passing (test/videos-get.e2e-spec.ts); unit suite 261 passing, e2e 80 passing; tsc clean; lint 0 errors
- **Observations:**
  - Scenario 1.2 (returns-metadata-when-ready) runs VideoProcessingService.process directly (idempotent, same service the worker will use) instead of waiting for a worker, because the video-worker entrypoint only exists from SI-03.22; waitForProcessing then confirms the ready state through the API. Once the worker is up this still passes (process() ignores non-processing videos); SI-03.23 covers the real worker path.

### SI-03.17 — Endpoint GET /videos/:publicId/stream
- **Status:** completed
- **Tests:** 4 e2e passing (test/videos-stream.e2e-spec.ts, real worker + MinIO, Range → 206); unit suite 266 passing; e2e green; tsc clean; lint 0 errors
- **Observations:**
  - Added createReadyVideo helper to src/test/video-flow.ts (uploads a generated MP4 and waits for the real compose worker); scenarios 1.1 and 1.2 of the spec are merged in one test since the Range request needs the Location from the redirect.
  - From here on the e2e suite depends on the compose video-worker being up.

### SI-03.18 — Endpoint GET /videos/:publicId/download
- **Status:** completed
- **Tests:** 4 e2e passing (test/videos-download.e2e-spec.ts); unit suite 266 passing; tsc clean; lint 0 errors
- **Observations:** none

### SI-03.19 — Endpoint GET /videos/:publicId/thumbnail
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.20 — MediaModule: ffprobe e ffmpeg sobre URL pré-assinada
- **Status:** completed
- **Tests:** 5 passing (4 integration with real ffprobe/ffmpeg + MinIO, 1 module unit); full suite green; tsc clean; lint 0 errors
- **Observations:**
  - Found while running SI-03.21's full suite: the SI-03.20 integration test used random bytes as the "not a video" object, and ffprobe sometimes sniffs them as MP3 (`Failed to read frame size`), which was classified retryable. Fixed in the SI-03.21 commit: deterministic non-video text in the test and `Failed to read frame size` added to the non-retryable patterns in `media.constants.ts`.

### SI-03.21 — VideoProcessingService: metadados e thumbnail
- **Status:** completed
- **Tests:** 11 passing (7 unit service, 1 module, 3 integration with PostgreSQL+MinIO+ffmpeg); full suite green; tsc clean; lint 0 errors
- **Observations:** none

### SI-03.22 — Worker de vídeo: processor BullMQ, retry/falha e entrypoint separado
- **Status:** completed
- **Tests:** 5 new (4 processor integration vs real Redis/PostgreSQL/MinIO/ffmpeg + 1 WorkerModule unit); unit suite 266 passing, e2e 80 passing; tsc clean; lint 0 errors; npm run build produces dist/main.js and dist/worker.js
- **Observations:**
  - CommonJS runtime validated: npm run build emits dist/main.js and dist/worker.js, and 'node dist/worker' boots in CJS loading the ESM-only @nestjs/bullmq (Node 25 require(esm)). The compose video-worker (start:worker:dev) is up, opens no HTTP port, and a throwaway e2e check showed it consuming the real queue and taking a generated MP4 to ready (not committed; SI-03.23 covers it).
  - WorkerModule also imports UsersModule: booting only CoreModule+VideosModule failed with 'Entity metadata for Channel#user was not found' because autoLoadEntities only sees entities registered via forFeature in loaded modules; UsersModule registers User.
  - CoreModule extracted from AppModule (ConfigModule.forRoot + TypeOrmModule.forRootAsync) with no behavior change; AppModule keeps the same imports otherwise.

### SI-03.23 — E2E ponta a ponta com a infraestrutura real do Compose
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.24 — Contrato OpenAPI e coleção de requests de vídeos
- **Status:** pending
- **Tests:** -
- **Observations:** none

