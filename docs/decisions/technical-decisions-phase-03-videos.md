---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-10-14
scope_description: "Upload and processing of videos up to 10GB: queue technology, presigned upload strategy, storage layout, video worker runtime and FFmpeg usage, unique video URL, streaming/download, and video status lifecycle with failure handling."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — API (presign/complete endpoints, video entity, stream/download endpoints, queue producer) and the Video Worker (queue consumer + FFmpeg/ffprobe), plus new `compose.yaml` services (object storage, queue broker, worker).
- `next-frontend/` — no standalone TD. Phase 03 lists no screens; the frontend only consumes the cross-layer contracts decided in TD-02 (upload handshake), TD-06 (video URL shape) and TD-07 (stream/download URLs). Those are decided once, as Cross-layer, per the skill rules.

**Already decided / out of scope (not reopened):** object storage is S3-compatible (MinIO in local Docker, swappable for S3); Docker Compose service names as hosts (CLAUDE.md); `ConfigModule` + Joi env validation (phase-01 TD-01/02/03); custom JWT guards (phase-02 TD-02); error-response standard (phase-02 TD-07); OpenAPI via `@nestjs/swagger` (openapi-docs-nestjs). Video metadata editing, categories and publication are Phase 04.

**Installed versions checked:** `nestjs-project` — NestJS 11, TypeORM 0.3.28, Joi 18, `module: nodenext`, no queue/S3/FFmpeg dependency yet. `next-frontend` — Next 16.2.6, React 19.2.4, `iron-session` BFF cookie session, `openapi-fetch`.

---

## TD-01: Queue Technology for Background Processing

**Scope:** Backend

**Capability:** "Serviço de processamento em segundo plano (filas)"

**Context:** The architecture diagram marks the message queue as "TBD". The API publishes a job when an upload completes; the worker consumes it. Needs retries with backoff, a way to fail permanently (corrupt file), long-running jobs (10GB files can take many minutes), and a NestJS-friendly API. Adds a service to `compose.yaml` and env keys (host/port) shared by API and worker. TD-04 and TD-08 depend on this choice.

**Options:**

### Option A: BullMQ on Redis (`@nestjs/bullmq`)
- Redis-backed queue; `@nestjs/bullmq` 12 (peer: `bullmq ^6`, Nest 11 compatible) provides `BullModule.registerQueue`, `@Processor` + `WorkerHost`. Job options `attempts` + `backoff`; `UnrecoverableError` sends a job straight to `failed`; stalled-job detection re-queues jobs whose worker lock lapsed (`maxStalledCount`, default 1). Verified in BullMQ/NestJS-Bull docs via context7.
- **Pros:** De facto standard in Nest; first-class retry/backoff/unrecoverable semantics; dashboards (Bull Board) available; the same Redis can later serve caching/rate limiting (phase-02 TD-08 throttler could move to it).
- **Cons:** Adds Redis as a new stateful service; Redis persistence (AOF) must be configured or queued jobs can be lost on restart; jobs and DB state can diverge (mitigated in TD-08).

### Option B: pg-boss (PostgreSQL as the queue)
- Queue table in the existing PostgreSQL using `SKIP LOCKED`; retries, backoff, expiration and dead-letter built in; no new infrastructure.
- **Pros:** Zero new services; job enqueue can share a DB transaction with the video row update (no divergence, effectively an outbox); fewer moving parts locally.
- **Cons:** No official Nest integration (custom provider/module); polling load on the primary DB; smaller ecosystem/tooling; not the pattern shown in the project diagram's "Message Queue" container, and it does not reduce later need for Redis if caching is wanted.

### Option C: RabbitMQ (`@nestjs/microservices` RMQ transport or `amqplib`)
- AMQP broker with durable queues, acks, dead-letter exchanges.
- **Pros:** Strong delivery guarantees, dead-lettering, language-agnostic consumers (worker could be non-Node).
- **Cons:** Heaviest to operate; retry/backoff and delayed retries must be assembled from DLX + TTL; Nest's RMQ transport targets request/response messaging more than job queues; overkill for a single job type.

**Recommendation:** **Option A (BullMQ)** — best Nest fit (`@nestjs/bullmq` + `WorkerHost`) with the exact semantics Phase 03 needs (attempts/backoff, `UnrecoverableError`, stalled detection); Redis is a small, common addition to `compose.yaml`. Option B is a legitimate runner-up if you prefer to avoid a new service — the trade is custom integration code for transactional enqueueing.

**Decision:** A (BullMQ on Redis via `@nestjs/bullmq`)
**Libraries:** @nestjs/bullmq, bullmq

---

## TD-02: Upload Strategy for Files up to 10GB (bypassing the API)

**Scope:** Cross-layer

**Capability:** "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance" · "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload" · "Serviço de armazenamento de arquivos (vídeos e thumbnails)"

**Context:** Section 4 of the plan requires uploads that don't lock the system and **can resume after connection failure**. The file must go browser → object storage directly. A single presigned `PUT` is excluded: S3 caps one PUT at 5GB, below the 10GB requirement. The handshake spans both subprojects: API (creates the draft video row at "initiate", signs, completes) and frontend (slices, uploads, retries). Cross-component contracts to keep consistent: storage endpoint env keys (**internal** `minio:9000` for API/worker vs **browser-reachable public endpoint** for presigned URLs, since the signed host must be reachable by the client — a Docker-networking trap), bucket CORS (`ExposeHeaders: ETag`, `PUT` from the frontend origin), and the initiate/complete API shapes. Depends on TD-03 for key layout and feeds TD-08 (completion triggers `UPLOADED`).

**Options:**

### Option A: S3 multipart upload with presigned `UploadPart` URLs
- `POST /videos/uploads` creates the draft video (status `UPLOADING`) and calls `CreateMultipartUpload`; the client requests presigned URLs per part (`getSignedUrl` + `UploadPartCommand`, from `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`), PUTs parts (e.g. 64–100MB, parallel, retried individually), then `POST .../complete` with `{partNumber, ETag}[]`. Resume = `ListParts` to find missing parts. API verifies with `HeadObject` and enqueues the job.
- **Pros:** Native S3/MinIO feature, no extra service; per-part retry and parallelism; resumable across page reloads if the frontend persists `uploadId`; file bytes never touch the API; works unchanged on S3 in production.
- **Cons:** Client logic is custom (part slicing, ETag collection, resume via ListParts); must set CORS ETag exposure; abandoned multipart uploads incur storage until aborted (needs a lifecycle rule/cleanup — see TD-08); presigning N parts means several API round trips.

### Option B: tus resumable protocol (tusd container or `@tus/server` with S3 store)
- Open resumable-upload protocol; the client (`tus-js-client`/Uppy) talks to a tus endpoint that writes to S3 via multipart internally.
- **Pros:** Resume, pause, and checksum handled by a mature protocol and client libs; less custom client code.
- **Cons:** The bytes pass through the tus server (extra service `tusd`, or Node inside/next to the API — the latter violates "without passing through the API" unless run as a separate process); auth needs hooks bridging JWT to tus; second public ingress and its own CORS/URL config; MinIO/S3 abstraction hidden behind tusd, so the "presigned" approach requested for the project isn't used.

### Option C: Streamed multipart through the API (`multipart/form-data` → S3 `Upload`)
- API accepts the file and streams it to S3 with `@aws-sdk/lib-storage` `Upload`.
- **Pros:** Simplest client; single request; API owns validation.
- **Cons:** Violates the requirement (10GB through the API, ties up connections/bandwidth); no resume on failure; proxy/body-size timeouts. Listed only as the baseline being rejected.

**Recommendation:** **Option A (S3 multipart + presigned part URLs)** — meets the 10GB and resume requirements with the project's already-chosen S3/MinIO, keeps bytes off the API, and adds no service. Accept the cost of ~one small frontend upload module and an abandoned-upload cleanup policy (TD-08).

**Decision:** A (S3 multipart upload with presigned `UploadPart` URLs)
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner
**Revisions:**
- 2026-10-14 — Phase 03 is backend-only (nestjs-project); the frontend multipart upload client is deferred to a later frontend phase/task. The handshake contract (initiate, presign parts, complete) is delivered by the API and exercised in backend e2e tests that PUT parts directly to MinIO. Rationale: scope clarified (AMB-1).

---

## TD-03: Object Storage Layout (Buckets and Keys)

**Scope:** Cross-layer

**Capability:** "Serviço de armazenamento de arquivos (vídeos e thumbnails)" · "Download do vídeo pelo usuário"

**Context:** Storage technology is fixed; this decides how it is used. The layout is cited by API (presign, stream), worker (read original, write thumbnail) and frontend (thumbnail URL), and by env schema + `compose.yaml` (bucket names, MinIO init). It must be stable before Phase 04 adds custom thumbnails. Keys must not depend on mutable data (title) and should not use the public URL id (TD-06) in a way that couples storage to routing.

**Options:**

### Option A: One private bucket, prefixes by asset type, keyed by internal video UUID
- e.g. `videos/{videoUuid}/original`, `videos/{videoUuid}/thumbnail.jpg`. All access via presigned URLs or API-mediated reads.
- **Pros:** One bucket to provision/CORS/lifecycle; simple env (`S3_BUCKET`); thumbnails and videos share access policy; easy to move to S3.
- **Cons:** Thumbnails (public, cacheable, listing-heavy in later phases) need a presigned URL each time — no direct CDN/public caching.

### Option B: Two buckets — private `videos` and public-read `thumbnails`
- Originals private; thumbnails readable by anonymous users at a stable URL.
- **Pros:** Thumbnail URLs are plain, cacheable, usable in `<img>`/`next/image` without signing; matches home/search listings (Phase 07).
- **Cons:** Two buckets to configure per environment; a public bucket means thumbnails of *draft/unlisted* videos are retrievable by anyone with the (unguessable) key; two env keys.

### Option C: Separate `uploads` (raw, short-lived) and `media` (processed) buckets
- Uploads land in `uploads`; worker publishes the final asset(s) to `media`.
- **Pros:** Clear lifecycle rules (expire raw uploads/incomplete parts aggressively); leaves room for transcoded renditions later.
- **Cons:** Phase 03 does no transcoding, so copying a multi-GB object is pure cost; more complexity than the phase needs.

**Recommendation:** **Option A (single private bucket, UUID-keyed prefixes)** — smallest surface for this phase; thumbnails can move to Option B later without changing keys if the key scheme (`videos/{uuid}/…`) is kept. Revisit when Phase 07 listings make signed thumbnail URLs a bottleneck.

**Decision:** A (One private bucket, `videos/{videoUuid}/…` prefixes)

---

## TD-04: Video Worker Runtime

**Scope:** Repo-wide

**Capability:** "Serviço de processamento em segundo plano (filas)" · "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** The architecture shows "Video Worker (FFmpeg)" as its own container consuming the queue and updating DB + storage. Processing 10GB files is CPU/IO heavy and must not run in the API process. Decides process boundary, code location, and image (FFmpeg binaries). Depends on TD-01 (BullMQ assumed below; adapts to B/C). Touches `compose.yaml`, Dockerfile(s) and env, so it is a repo/infra concern.

**Options:**

### Option A: Same NestJS codebase, second entrypoint and compose service
- `src/worker.ts` bootstraps `NestFactory.createApplicationContext(WorkerModule)` (no HTTP); `@Processor` classes live there. Same image/Dockerfile with `ffmpeg` installed, different `command`. Reuses TypeORM entities, config and Joi schema.
- **Pros:** Shares entities/config/types (no duplicated `Video` entity or env schema); one build, one lint/test setup; independently scalable and restartable container; API image can stay FFmpeg-free if a second Dockerfile target is used.
- **Cons:** Worker and API deploy in lockstep; module boundaries must be policed so the worker doesn't import controllers.

### Option B: Separate subproject `video-worker/` (own package.json)
- Standalone Node app; talks to DB and S3 directly.
- **Pros:** Fully independent versioning/deploy; can be swapped to another language later.
- **Cons:** Duplicates the Video entity/status enum/env schema or requires a shared package (monorepo tooling not present); doubles lint/test/CI config; heavier than needed for a single job type.

### Option C: In-process processor inside the API
- `@Processor` registered in the API app.
- **Pros:** Zero extra deployment.
- **Cons:** FFmpeg runs (or is awaited) in the API's container, contradicting the diagram and the "no performance impact" requirement; a crash or OOM takes the API down. Rejected unless only used in tests.

**Recommendation:** **Option A (same codebase, separate entrypoint/container)** — honors the diagram's separate worker without duplicating entities and config; a split into Option B remains possible later since the worker module is already isolated.

**Decision:** A (Same NestJS codebase, separate worker entrypoint and compose service)

---

## TD-05: FFmpeg/ffprobe Invocation, Metadata Extraction and Thumbnail Generation

**Scope:** Backend

**Capability:** "Processamento automático do vídeo após upload (extração de duração e metadados)" · "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The worker must extract duration and metadata (codec, resolution, bitrate, size) and produce a thumbnail from one frame, for files up to 10GB. Decides how FFmpeg is invoked and how the input is accessed — this determines disk requirements and time. Metadata fields persisted are a contract with Phase 05 (player) and Phase 04 (panel). Depends on TD-04.

**Options:**

### Option A: Spawn `ffprobe`/`ffmpeg` directly (`child_process.spawn`) reading from a presigned GET URL
- `ffprobe -v error -print_format json -show_format -show_streams <presigned-url>` for metadata; `ffmpeg -ss <t> -i <url> -frames:v 1 -vf scale=… thumb.jpg` for the frame (input seek before `-i`, so only needed byte ranges are fetched via HTTP Range). Thumbnail uploaded back to storage with `PutObject`. Timestamp: e.g. 10% of duration, clamped, fallback to 1s for very short files.
- **Pros:** No 10GB download to worker disk; fastest for MP4 with `moov` at the start (otherwise ffprobe seeks the tail via Range, still fine); no wrapper dependency; explicit control of args/timeouts; typed with a small parser for ffprobe JSON.
- **Cons:** Must handle presigned URL expiry for long reads (sign with enough TTL); the worker's internal MinIO host must be used for signing there (see TD-02 endpoint trap); some containers (e.g. unusual MKV/AVI) behave poorly over HTTP and may need fallback.

### Option B: Download original to local temp disk, then run FFmpeg on the file
- Stream `GetObject` to a temp path, run ffprobe/ffmpeg locally, delete afterward.
- **Pros:** Most compatible with any container; deterministic; simplest failure semantics.
- **Cons:** Needs up to 10GB × concurrency of scratch disk and minutes of copy time for a ~1s job; wasted I/O.

### Option C: `fluent-ffmpeg` wrapper
- Fluent API with `ffprobe()` and `screenshots()` (documented in context7).
- **Pros:** Convenient API and screenshot helper.
- **Cons:** The npm package now reports **"Package no longer supported"** (checked with `npm view` on 2026-10-14) and the repo is unmaintained; adding it knowingly introduces dead dependency risk for what is two CLI calls.

**Recommendation:** **Option A (direct CLI over presigned URL), with Option B as an automatic fallback on ffprobe/ffmpeg input error** — avoids moving 10GB to the worker and avoids the unsupported wrapper. If you prefer a single code path, choose B and size scratch disk accordingly.

**Decision:** A (Spawn `ffprobe`/`ffmpeg` directly over a presigned GET URL)

**Note:** The automatic Option B fallback (download to scratch disk) is **not** adopted in Phase 03. A single code path keeps the worker small and fully testable against MinIO; an input error is treated like any other processing error (retry with backoff, then `FAILED` with reason, per TD-08). Revisit only if real uploads in exotic containers fail over HTTP.

---

## TD-06: Unique Video URL Strategy

**Scope:** Cross-layer

**Capability:** "URL única por vídeo, sem conflito com outros vídeos"

**Context:** Plan section 4: each video needs a **short, unique URL that never conflicts**. The id is assigned at draft creation (upload initiation, before any title exists), appears in the API (`/videos/:publicId`) and in the Next.js route (e.g. `/watch/:publicId`), and is used for unlisted links — so guessability matters. It is distinct from the internal primary key used for storage keys (TD-03).

**Options:**

### Option A: Random short id (nanoid-style, ~11 chars, URL-safe alphabet) in a unique-indexed column
- Generated with a CSPRNG; `UNIQUE` constraint with insert-retry on the (astronomically rare) conflict. Note `nanoid` 6 is ESM-only (`type: module`) while the backend is TypeScript/Nest — verify it loads under the project's `nodenext` + Jest setup, or implement the same with `crypto.randomBytes` + base62 (≈10 lines, no dependency).
- **Pros:** Short, unguessable (safe for unlisted), no coordination, conflict-free in practice and guaranteed by the DB constraint.
- **Cons:** Requires the retry loop; ESM interop to verify if using the library.

### Option B: UUID (v4 or v7) as the public id
- `uuid` column used directly in the URL.
- **Pros:** No generation code or retry (Postgres `gen_random_uuid()`); zero collision handling.
- **Cons:** 36 characters — not "short"; v7 is time-ordered and leaks creation time; ugly share links.

### Option C: Encoded sequential id (Sqids/Hashids over the serial PK)
- Reversible encoding of the integer key.
- **Pros:** Short, deterministic uniqueness, no collision handling.
- **Cons:** Salt/alphabet is a secret that cannot be rotated without breaking links; encoded ids are not truly unguessable, which weakens unlisted privacy; extra dependency; leaks volume ordering.

**Recommendation:** **Option A (random 11-char id with DB unique constraint)** — satisfies "short and never conflicts" via the constraint, and keeps unlisted links unguessable; prefer the `crypto`-based generator if the ESM-only `nanoid` complicates the Jest/CommonJS setup.

**Decision:** A (Random 11-char URL-safe id + `UNIQUE` constraint)

**Note:** Generated with Node's `crypto` (CSPRNG, base62 alphabet) instead of the `nanoid` package, avoiding the ESM-only interop risk under `module: nodenext` + Jest flagged above. Insert retries on unique-violation.

---

## TD-07: Streaming (Range / 206) and Download Delivery

**Scope:** Cross-layer

**Capability:** "Reprodução via streaming (sem necessidade de download completo)" · "Download do vídeo pelo usuário"

**Context:** Playback must start without downloading the whole file, which requires HTTP Range support (`206 Partial Content`, `Accept-Ranges: bytes`). The diagram shows the frontend streaming directly from object storage. Anonymous users can watch, but draft/unlisted rules from Phase 04 mean access must be decidable by the API later. Frontend `<video src>` and download links consume the URL form chosen here. Depends on TD-03 (key layout) and TD-02 (public endpoint config).

**Options:**

### Option A: API issues a short-lived presigned GET (redirect or JSON) — storage serves the bytes
- `GET /videos/:publicId/stream` authorizes, then responds `302` to a presigned `GetObject` URL (or returns the URL as JSON for the player); S3/MinIO natively answers `Range` with `206`. Download: same endpoint family with `ResponseContentDisposition: attachment; filename="…"` in the presigned command.
- **Pros:** API never carries video bytes; range handling is storage's job; authorization stays centralized (ready for draft/unlisted in Phase 04); same code for MinIO and S3.
- **Cons:** URL expiry during long playback (TTL must be generous or the player must re-request); redirects with `Range` rely on browser media behavior (supported by mainstream browsers, to be tested); signed host must be the public endpoint (TD-02).

### Option B: API proxy that implements Range itself (stream from S3 to client)
- API reads `Range` header, calls `GetObject` with `Range`, and replies `206` with `Content-Range`/`Accept-Ranges`.
- **Pros:** Full control over auth, headers and logging; URL never expires; storage can stay unreachable from browsers.
- **Cons:** Video bytes consume API bandwidth/connections — undermines the performance goal; must correctly implement single/suffix/invalid ranges (`416`); needs a test-heavy implementation.

### Option C: Public-read objects behind unguessable keys (optionally behind a CDN/reverse proxy)
- Frontend plays `https://storage/…/videos/{uuid}/original` directly.
- **Pros:** Simplest and CDN-friendly; no expiry.
- **Cons:** No authorization — drafts/unlisted/deleted videos remain retrievable by anyone with the key; incompatible with Phase 04 visibility rules and with the private bucket in TD-03 Option A.

**Recommendation:** **Option A (presigned GET via API redirect, with `Content-Disposition` for download)** — the API stays out of the byte path while still deciding who may watch; choose a TTL of a few hours and verify seek/resume behavior in an e2e test against MinIO.

**Decision:** A (API authorizes and redirects `302` to a short-lived presigned GET; download adds `ResponseContentDisposition: attachment`)

---

## TD-08: Video Status Lifecycle and Processing-Failure Behavior

**Scope:** Backend

**Capability:** "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload" · "Processamento automático do vídeo após upload (extração de duração e metadados)" · "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance"

**Context:** The video row is created as a **draft** at upload start, then moves through upload and processing. Phase 04 adds draft → published and visibility (public/unlisted), and its panel shows "status". The processing state must be representable without clashing with that publication state. Also needs: what happens when ffprobe fails or the worker dies, how upload completion triggers the job without losing it, and cleanup of abandoned uploads. Depends on TD-01, TD-02, TD-05.

**Options:**

### Option A: Separate `processingStatus` and (Phase 04) `publicationStatus`
- `processingStatus`: `UPLOADING → UPLOADED → PROCESSING → READY | FAILED`. Publication/visibility (`DRAFT`/`PUBLISHED`, `PUBLIC`/`UNLISTED`) is an independent column added in Phase 04; Phase 03 creates every video with publication = draft. Failure: BullMQ `attempts: 3` + exponential backoff for transient errors (S3/network); `UnrecoverableError` for invalid media (ffprobe says not a video) → `FAILED` with `failureReason`. A video can only be published when `READY`. Completion: client calls `complete`; API commits `UPLOADED`, **then** enqueues; a periodic sweeper re-enqueues rows stuck in `UPLOADED` (covers a lost enqueue) and a storage lifecycle rule/cron aborts incomplete multipart uploads and marks stale `UPLOADING` as `FAILED`. A failed video can be retried via an endpoint (re-enqueue) or re-uploaded.
- **Pros:** No state explosion (processing × publication are independent); Phase 04 adds a column rather than rewriting the enum; explicit failure semantics; survives worker or enqueue loss.
- **Cons:** Two columns to keep consistent (invariant: publishable only if `READY`); sweeper adds a small scheduled job.

### Option B: Single combined status enum
- e.g. `UPLOADING, PROCESSING, DRAFT, PUBLISHED, FAILED`.
- **Pros:** One field; easy to display.
- **Cons:** Conflates pipeline state with publication; visibility (public/unlisted) multiplies values; Phase 04 must migrate the enum; "draft but still processing" is unrepresentable.

### Option C: Status plus append-only `video_processing_events` table
- Option A's columns plus a log of transitions/errors per attempt.
- **Pros:** Full audit/debug trail of failures and retries.
- **Cons:** Extra table and writes not required by any Phase 03 capability; BullMQ already keeps per-job failure history (`failedReason`, `attemptsMade`).

**Recommendation:** **Option A (independent processing and publication statuses; retry+backoff then `FAILED` with reason; sweeper for lost enqueues)** — it keeps Phase 04's publication flow additive and makes failure behavior explicit. Option C can be layered later if auditing becomes a need.

**Decision:** A (Independent processing and publication statuses; retry with backoff, then `FAILED` with reason)

**Note:** Adjusted from the Recommendation in two points. (1) The capability "Pré-cadastro automático do vídeo como rascunho" must be representable already in Phase 03, so the `publicationStatus` column is created **now** with default `DRAFT` (the only value written in this phase; Phase 04 adds the transition to published and visibility). The Recommendation's "created as draft" otherwise had no column to live in. (2) `processingStatus` is `UPLOADING → PROCESSING → READY | FAILED` (no separate `UPLOADED` state) and the periodic sweeper is dropped: `complete` is idempotent and enqueues with a deterministic BullMQ `jobId` (the video id), so a lost enqueue is recovered by the client retrying `complete`. Abandoned multipart uploads are cleaned by an `AbortIncompleteMultipartUpload` lifecycle rule on the bucket.
**Revisions:**
- 2026-10-14 — No ambiente local, a limpeza de uploads multipart abandonados usa a configuração nativa do MinIO (`stale_uploads_expiry=24h`, `stale_uploads_cleanup_interval=6h`), aplicada pelo serviço `minio-init` do Compose; em S3 real a intenção da decisão é atendida pela regra de lifecycle `AbortIncompleteMultipartUpload` no bucket. _Rationale:_ o MinIO não suporta a ação `AbortIncompleteMultipartUpload` em `PutBucketLifecycle` (o servidor rejeita a configuração com `InvalidArgument`, verificado na implementação do SI-03.1), então a regra de bucket citada na Note não pode ser aplicada localmente; o resultado esperado (partes abandonadas removidas após ~1 dia) é o mesmo.

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Queue technology | A — BullMQ on Redis (`@nestjs/bullmq`) | A (BullMQ on Redis) |
| TD-02 | Cross-layer | Upload strategy up to 10GB | A — S3 multipart with presigned part URLs | A (S3 multipart + presigned parts) |
| TD-03 | Cross-layer | Object storage layout (buckets/keys) | A — single private bucket, UUID-keyed prefixes | A (single private bucket) |
| TD-04 | Repo-wide | Video worker runtime | A — same codebase, separate entrypoint/container | A (same codebase, separate worker container) |
| TD-05 | Backend | FFmpeg/ffprobe invocation, metadata, thumbnail | A — direct CLI over presigned URL (B fallback) | A (direct CLI over presigned URL, no fallback) |
| TD-06 | Cross-layer | Unique video URL (public id) | A — random 11-char id + unique constraint | A (random 11-char id, `crypto`-based) |
| TD-07 | Cross-layer | Streaming (Range/206) and download | A — presigned GET via API, `Content-Disposition` for download | A (302 to presigned GET) |
| TD-08 | Backend | Status lifecycle and failure handling | A — separate processing/publication status, retry then `FAILED` | A (separate statuses; `publicationStatus` created now) |
