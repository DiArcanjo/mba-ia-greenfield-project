# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 5/24 completed

### SI-03.1 — Infra: MinIO, Redis, worker e FFmpeg no Docker Compose
- **Status:** completed
- **Tests:** no tests (infra); ACs verified manually (services listed, minio/redis healthy, minio-init exit 0 with bucket created, PONG, ffprobe ok)
- **Observations:**
  - Image origin changed per user decision: MinIO no longer publishes public images (Docker Hub `minio/minio` and `minio/mc` fail to pull), so `cgr.dev/chainguard/minio:latest` and `cgr.dev/chainguard/minio-client:latest` (Chainguard packaging of the same MinIO) are used. TD-03 unchanged (still S3-compatible MinIO).
  - Chainguard images have no `/bin/sh`/curl: minio healthcheck uses bash `/dev/tcp` against `/minio/health/live`; `minio-init` entrypoint is `/usr/bin/bash -c`.
  - `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` added to `.env` (gitignored) with compose defaults; `.env.example` is updated in SI-03.2.

### SI-03.2 — Dependências e namespaces de configuração (storage, fila, vídeo)
- **Status:** completed
- **Tests:** 12 passing in src/config (7 new in env.validation.integration-spec.ts); tsc clean; lint 0 errors
- **Observations:**
  - `S3_ACCESS_KEY`/`S3_SECRET_KEY` are now required by the Joi schema, so the existing `requiredEnv` fixture in `env.validation.integration-spec.ts` was extended with them.
  - `.env` (gitignored) updated with all new vars; `MINIO_ROOT_*` also added to `.env.example`.

### SI-03.3 — StorageModule: cliente S3/MinIO e operações de objeto
- **Status:** pending
- **Tests:** -
- **Observations:** none

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
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.8 — VideosService: posse, transições de status e DTO de resposta
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.9 — Início do upload: pré-cadastro do rascunho e sessão multipart
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.10 — Handshake de upload: URLs de partes, retomada e conclusão
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.11 — Endpoint POST /videos
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.12 — Endpoint POST /videos/:publicId/upload/parts
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.13 — Endpoint GET /videos/:publicId/upload
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.14 — Endpoint POST /videos/:publicId/upload/complete
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.15 — VideoDeliveryService: URLs de streaming, download e thumbnail
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.16 — Endpoint GET /videos/:publicId
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.17 — Endpoint GET /videos/:publicId/stream
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.18 — Endpoint GET /videos/:publicId/download
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.19 — Endpoint GET /videos/:publicId/thumbnail
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.20 — MediaModule: ffprobe e ffmpeg sobre URL pré-assinada
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.21 — VideoProcessingService: metadados e thumbnail
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.22 — Worker de vídeo: processor BullMQ, retry/falha e entrypoint separado
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.23 — E2E ponta a ponta com a infraestrutura real do Compose
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.24 — Contrato OpenAPI e coleção de requests de vídeos
- **Status:** pending
- **Tests:** -
- **Observations:** none

