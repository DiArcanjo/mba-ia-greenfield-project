---
libs:
  "@nestjs/bullmq":
    version: "^12.0.0"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-10-14T20:10:00-03:00"
  "bullmq":
    version: "^6.3.15"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-10-14T20:10:00-03:00"
  "@aws-sdk/client-s3":
    version: "^3.1152.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-14T20:10:00-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1152.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-14T20:10:00-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-14T20:06:40-03:00"
---

# Library References — phase-03-videos

Versions confirmed with `npm view` on 2026-10-14. `@nestjs/bullmq@12` peers accept `@nestjs/core ^11` (project uses ^11.0.1) and `bullmq ^6`, so no version discrepancy. Context7 has no dedicated `@nestjs/bullmq` entry; the `/nestjs/bull` docs cover both `@nestjs/bull` and `@nestjs/bullmq`.

### @nestjs/bullmq
- TD-01. Worker classes use `@Processor('queue-name')` and extend `WorkerHost`, implementing `process(job: Job)`; the `Job` type is imported from `bullmq`.
- Event listeners use `@OnWorkerEvent('failed' | 'completed' | 'error' | 'stalled' | …)` on methods of the same `@Processor` class (it must extend `WorkerHost`).
- Queues are registered with `BullModule.registerQueue({ name })`, with the Redis connection set up once through `BullModule.forRoot`. Per-queue `defaultJobOptions` (e.g. `attempts`) are supported.
- Redis host is the Compose service name (e.g. `redis`), never `localhost`.

### bullmq
- TD-01 / TD-08. Retry with exponential backoff: `queue.add(name, data, { attempts: N, backoff: { type: 'exponential', delay: 1000 } })`. The delay is `2^(attempt-1) * delay` ms, and `jitter` is optional.
- `throw new UnrecoverableError(msg)` in the processor moves the job to failed with no further retries, overriding `attempts`.
- Adding a job with a custom `jobId` that already exists does NOT throw or overwrite; it returns the existing job and emits a `duplicated` event. This is what makes `complete` idempotent (`jobId` = video id).

### @aws-sdk/client-s3
- TD-02 / TD-03 / TD-07. Commands are sent with `client.send(new XCommand(input))`.
- Multipart flow: `CreateMultipartUploadCommand` → per-part `UploadPartCommand({ Bucket, Key, UploadId, PartNumber })` → `ListPartsCommand` (resume) → `CompleteMultipartUploadCommand({ MultipartUpload: { Parts: [{ PartNumber, ETag }] } })`. `AbortMultipartUploadCommand` aborts an upload.
- The ETag comes from the part PUT response. If it is missing, the bucket CORS lacks `ExposeHeaders: ETag`.
- `HeadObjectCommand({ Bucket, Key })` returns `ContentLength`, `ContentType`, and so on. It is used to verify the object before enqueueing.
- MinIO needs `forcePathStyle: true` and a custom `endpoint`. Use the internal endpoint (`minio:9000`) for the API and worker, and a separate public endpoint for presigning so the signed host is browser-reachable.
- Download: `GetObjectCommand` with `ResponseContentDisposition: 'attachment; filename=…'`.

### @aws-sdk/s3-request-presigner
- TD-02 / TD-07. `getSignedUrl(client, new UploadPartCommand({...}), { expiresIn })` presigns part PUTs, and `getSignedUrl(client, new GetObjectCommand({...}), { expiresIn })` presigns streaming GETs.
- `Content-Type` is unsignable by default (opt in via `signableHeaders`). The payload is `UNSIGNED-PAYLOAD`, so Content-Length is not enforced by the signature.
