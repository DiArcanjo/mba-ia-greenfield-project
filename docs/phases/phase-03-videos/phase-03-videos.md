---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-14T20:07:04-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-14T20:07:04-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-14T20:06:40-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-14T19:37:21-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar, no `nestjs-project`, o ciclo completo de upload e processamento de vídeos: serviço de armazenamento de objetos (MinIO/S3) e fila em segundo plano (BullMQ/Redis), upload multipart direto ao storage para arquivos de até 10GB com pré-cadastro do vídeo como rascunho, worker FFmpeg que extrai duração/metadados e gera thumbnail, URL única por vídeo e entrega de streaming (Range/206) e download — tudo exercitado em testes de integração e e2e contra a infraestrutura real do Docker Compose (MinIO, Redis e worker).

---

## Step Implementations

### SI-03.1 — Infra: MinIO, Redis, worker e FFmpeg no Docker Compose

**Description:** Adicionar ao `nestjs-project/compose.yaml` a infraestrutura nova da fase (object storage, broker de fila e o container do worker de vídeo) e instalar o FFmpeg na imagem de desenvolvimento, sempre usando nomes de serviço como host.

**Technical actions:**

1. Adicionar o serviço `minio` (`minio/minio`, `server /data --console-address ":9001"`, portas `9000` e `9001`, volume nomeado, credenciais por `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, healthcheck) e o serviço one-shot `minio-init` (`minio/mc`, `restart: "no"`, `depends_on: minio (service_healthy)`) que cria o bucket `streamtube-videos` de forma idempotente (`mc mb --ignore-existing`) (per `phase-03-videos/TD-03`)
2. Adicionar o serviço `redis` (`redis:7-alpine`, porta `6379`, healthcheck `redis-cli ping`) (per `phase-03-videos/TD-01`)
3. Adicionar o serviço `video-worker` reutilizando o `build` de `Dockerfile.dev` do `nestjs-api`, mesmo bind mount, `command: npm run start:worker:dev`, `depends_on` em `db` e `redis` (`service_healthy`) e `minio-init` (`service_completed_successfully`); incluir `redis` e `minio-init` no `depends_on` do `nestjs-api` (per `phase-03-videos/TD-04`)
4. Editar `nestjs-project/Dockerfile.dev` para instalar `ffmpeg` (que provê `ffprobe`) junto de `procps`/`curl`, de modo que a API (testes de integração) e o worker usem a mesma imagem (per `phase-03-videos/TD-05`)
5. Atualizar `nestjs-project/CLAUDE.md` — lista de serviços (`minio`, `redis`, `video-worker`) e verificações de prontidão (`docker compose exec redis redis-cli ping` → `PONG`; `docker compose logs minio-init`), incluindo a nota de que o `video-worker` precisa estar de pé para os e2e de processamento

_Decisão de build:_ o worker compartilha a imagem do `nestjs-api` (um único `Dockerfile.dev` com FFmpeg) em vez de um Dockerfile dedicado — permite que os testes de integração de `MediaToolsService` rodem `ffprobe`/`ffmpeg` reais dentro de `nestjs-api` sem duplicar imagem. O script `start:worker:dev` só passa a existir no SI-03.22; até lá o serviço `video-worker` está definido mas não é iniciado.

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- `docker compose config --services` lista `minio`, `minio-init`, `redis` e `video-worker`
- `docker compose up -d minio redis` deixa ambos `healthy` em `docker compose ps`
- `docker compose logs minio-init` mostra o bucket `streamtube-videos` criado (ou já existente) e o container termina com código `0`
- `docker compose exec redis redis-cli ping` responde `PONG`
- `docker compose exec nestjs-api ffprobe -version` termina com código `0`
- Nenhum valor de host em `compose.yaml` ou nos serviços usa `localhost`/`127.0.0.1` para comunicação entre containers

---

### SI-03.2 — Dependências e namespaces de configuração (storage, fila, vídeo)

**Description:** Instalar as bibliotecas decididas na fase e criar os namespaces `storage`, `queue` e `video` no padrão `registerAs`, com validação Joi e variáveis no `.env.example`/`.env`.

**Technical actions:**

1. Instalar em `nestjs-project`: `@nestjs/bullmq@^12.0.0`, `bullmq@^6.3.15`, `@aws-sdk/client-s3@^3.1152.0`, `@aws-sdk/s3-request-presigner@^3.1152.0` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`; versões confirmadas em `library-refs.md`)
2. Criar `src/config/storage.config.ts` — `registerAs('storage', ...)` com `endpoint` (`S3_ENDPOINT`, default `http://minio:9000`), `publicEndpoint` (`S3_PUBLIC_ENDPOINT`, default = `endpoint`), `region` (`S3_REGION`, default `us-east-1`), `accessKey` (`S3_ACCESS_KEY`), `secretKey` (`S3_SECRET_KEY`), `bucket` (`S3_BUCKET`, default `streamtube-videos`), `forcePathStyle: true` (per `phase-03-videos/TD-02`)
3. Criar `src/config/queue.config.ts` — `registerAs('queue', ...)` com `redisHost` (`REDIS_HOST`, default `redis`), `redisPort` (`REDIS_PORT`, default `6379`), `prefix` (`QUEUE_PREFIX`, default `streamtube`), `attempts` (`VIDEO_PROCESSING_ATTEMPTS`, default `3`), `backoffMs` (`VIDEO_PROCESSING_BACKOFF_MS`, default `5000`) (per `phase-03-videos/TD-01`, `phase-03-videos/TD-08`)
4. Criar `src/config/video.config.ts` — `registerAs('video', ...)` com `maxSizeBytes` (`VIDEO_MAX_SIZE_BYTES`, default `10737418240`), `partSizeBytes` (`VIDEO_PART_SIZE_BYTES`, default `67108864`; mínimo `5242880` exigido pelo S3), `partUrlTtlSeconds` (`VIDEO_PART_URL_TTL_SECONDS`, default `3600`), `streamUrlTtlSeconds` (`VIDEO_STREAM_URL_TTL_SECONDS`, default `10800`) (per `phase-03-videos/TD-02`, `phase-03-videos/TD-07`)
5. Atualizar `src/config/env.validation.ts` (`S3_ACCESS_KEY`/`S3_SECRET_KEY` obrigatórios, `VIDEO_PART_SIZE_BYTES` com `min(5242880)`, demais com default), registrar as três configs em `ConfigModule.forRoot({ load })` em `src/app.module.ts` e adicionar todas as variáveis ao `.env.example` e `.env` (`S3_ENDPOINT=http://minio:9000`, `S3_PUBLIC_ENDPOINT=http://minio:9000`, `REDIS_HOST=redis`, credenciais `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` iguais a `S3_ACCESS_KEY`/`S3_SECRET_KEY`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` (novas variáveis) | Integration: obrigatoriedade, defaults e `min` do tamanho de parte | `src/config/env.validation.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- A aplicação inicia com as novas variáveis definidas e `GET /` continua respondendo `200`
- Iniciar sem `S3_ACCESS_KEY` ou `S3_SECRET_KEY` falha no bootstrap com erro de validação Joi
- `VIDEO_PART_SIZE_BYTES=1024` é rejeitado pela validação (abaixo do mínimo de 5 MiB do S3)
- Sem `REDIS_HOST`, `QUEUE_PREFIX` e `S3_BUCKET` definidos, os defaults `redis`, `streamtube` e `streamtube-videos` são aplicados

---

### SI-03.3 — StorageModule: cliente S3/MinIO e operações de objeto

**Description:** Criar o módulo que encapsula todo o acesso ao object storage (multipart, presign, head/put/delete) para que nenhum outro módulo conheça o SDK da AWS.

**Technical actions:**

1. Criar `src/storage/storage.constants.ts` — tokens `S3_CLIENT` (operações, endpoint interno `minio:9000`) e `S3_PRESIGN_CLIENT` (assinatura, `publicEndpoint`), e `STORAGE_KEYS` com os builders `videoOriginal(id)` → `videos/{id}/original` e `videoThumbnail(id)` → `videos/{id}/thumbnail.jpg` (per `phase-03-videos/TD-03`)
2. Criar `src/storage/storage.service.ts` — métodos multipart sobre `@aws-sdk/client-s3`: `createMultipartUpload(key, contentType)`, `presignUploadPart(key, uploadId, partNumber, expiresIn)` (via `getSignedUrl` de `@aws-sdk/s3-request-presigner`), `listParts(key, uploadId)` (percorre todas as páginas por `PartNumberMarker`), `completeMultipartUpload(key, uploadId, parts)`, `abortMultipartUpload(key, uploadId)` (per `phase-03-videos/TD-02`)
3. Em `StorageService`, adicionar métodos de objeto: `headObject(key)` (retorna `ContentLength`/`ContentType`), `putObject(key, body, contentType)`, `deleteObject(key)` e `presignGetObject(key, { expiresIn, downloadFilename? })` — quando `downloadFilename` existe, define `ResponseContentDisposition: attachment; filename*=UTF-8''<nome codificado>` (per `phase-03-videos/TD-07`)
4. Criar `src/storage/storage.module.ts` — providers `S3_CLIENT`/`S3_PRESIGN_CLIENT` via `useFactory` com `storageConfig.KEY` (`forcePathStyle: true`, credenciais e região da config; clientes distintos apenas pelo `endpoint`), `StorageService` e `exports: [StorageService]`
5. Criar `src/test/storage.ts` — helpers de teste contra o MinIO real do Compose: `uploadPartViaPresignedUrl(url, bytes)` (retorna o `ETag` do header de resposta), `deleteKeysByPrefix(prefix)` para limpeza e `getRangeViaUrl(url, range)`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration (MinIO real): multipart de 2 partes (5 MiB + resto) → `listParts` → `completeMultipartUpload` → `headObject`; `presignGetObject` com `Range` retorna `206`; `downloadFilename` produz `Content-Disposition: attachment`; `deleteObject`; `abortMultipartUpload` | `src/storage/storage.service.integration-spec.ts` |
| `StorageModule` | Unit: compilação do módulo com `ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] })` | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.1, SI-03.2

**Acceptance criteria:**

- Um objeto enviado em 2 partes via URLs pré-assinadas é lido de volta com o mesmo conteúdo e `ContentLength` igual à soma das partes
- `GET` na URL de `presignGetObject` com `Range: bytes=0-99` retorna `206` com 100 bytes
- `GET` na URL gerada com `downloadFilename` retorna o header `Content-Disposition` começando com `attachment`
- `listParts` de um upload com 2 partes enviadas retorna os números `1` e `2` com `ETag`
- Após `deleteObject`, `headObject` da mesma chave falha com erro de objeto inexistente

---

### SI-03.4 — Entidade Video, migration e VideosModule base

**Description:** Criar a entidade `Video` com os dois status independentes, a migration correspondente gerada pela CLI do TypeORM e o `VideosModule` inicial que registra a entidade.

**Technical actions:**

1. Criar `src/videos/video.types.ts` — enums `ProcessingStatus` (`uploading`, `processing`, `ready`, `failed`) e `PublicationStatus` (`draft`, `published`) (per `phase-03-videos/TD-08`)
2. Criar `src/videos/entities/video.entity.ts` conforme `### Data Model → Video` (`@Entity('videos')`, colunas `snake_case`, transformers `string → number` em `size_bytes` e `duration_seconds`, `@ManyToOne(() => Channel, (c) => c.videos)` com `@JoinColumn({ name: 'channel_id' })`, índices) e adicionar o lado inverso `@OneToMany(() => Video, (v) => v.channel) videos` em `src/channels/entities/channel.entity.ts` (per `phase-03-videos/TD-06`, `phase-03-videos/TD-08`)
3. Gerar a migration com `npm run migration:generate -- src/database/migrations/CreateVideos` (CLI, sem SQL manual) e aplicá-la com `npm run migration:run`
4. Criar `src/videos/videos.module.ts` com `imports: [TypeOrmModule.forFeature([Video])]` e `exports: [TypeOrmModule]`
5. Atualizar `src/test/create-test-data-source.ts` (`cleanAllTables` passa a apagar `videos` antes de `channels`) e a lista de migrations/entidades em `src/database/migrations.integration-spec.ts`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: `public_id` único, defaults (`uploading`/`draft`), FK `channel_id`, valores dos enums, round-trip de `size_bytes` (> 2^31) e `duration_seconds` como `number` | `src/videos/entities/video.entity.integration-spec.ts` |
| Migration `CreateVideos` | Integration: aplica e reverte em sequência com as demais | `src/database/migrations.integration-spec.ts` |
| `VideosModule` | Unit: compilação do módulo | `src/videos/videos.module.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Inserir dois vídeos com o mesmo `public_id` viola a unicidade e o segundo insert falha
- Um vídeo inserido sem status explícitos persiste `processing_status = 'uploading'` e `publication_status = 'draft'`
- Um vídeo com `size_bytes = 10737418240` é lido de volta como o número `10737418240`
- Inserir vídeo com `channel_id` inexistente falha por violação de chave estrangeira
- `npm run migration:run` seguido de `npm run migration:revert` deixa o banco sem a tabela `videos` e sem os tipos enum, e reaplicar a migration funciona

---

### SI-03.5 — Gerador de id público do vídeo

**Description:** Implementar o gerador do identificador curto e URL-safe que compõe a URL única de cada vídeo, sem dependência externa.

**Technical actions:**

1. Criar `src/videos/public-id.util.ts` — `generatePublicId()` usando `crypto.randomBytes(8).toString('base64url')` (8 bytes → exatamente 11 caracteres `[A-Za-z0-9_-]`) e a constante `PUBLIC_ID_PATTERN` (`^[A-Za-z0-9_-]{11}$`) exportada para os asserts de formato em testes (per `phase-03-videos/TD-06`)

_Decisão de build:_ gerador baseado em `crypto` (sem `nanoid`), conforme a ressalva da TD sobre o `nanoid` ser ESM-only no setup Jest/CommonJS do projeto. Colisões são tratadas pela constraint `UNIQUE` + retry no serviço (SI-03.9), não pelo gerador.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `generatePublicId` | Unit: comprimento 11, charset URL-safe, casa `PUBLIC_ID_PATTERN`, 10 000 ids sem repetição | `src/videos/public-id.util.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Cada id gerado tem exatamente 11 caracteres e usa apenas `A-Z`, `a-z`, `0-9`, `_` e `-`
- Em 10 000 gerações consecutivas não há ids repetidos

---

### SI-03.6 — Exceções de domínio de vídeo e busca de canal por usuário

**Description:** Declarar as exceções de domínio do `### Error Catalog` e expor em `ChannelsService` a busca do canal do usuário autenticado, pré-requisitos dos serviços de vídeo.

**Technical actions:**

1. Adicionar em `src/common/exceptions/domain.exception.ts` as subclasses de `DomainException`: `VideoNotFoundException` (`VIDEO_NOT_FOUND`, 404), `ChannelNotFoundException` (`CHANNEL_NOT_FOUND`, 404), `VideoTooLargeException` (`VIDEO_TOO_LARGE`, 413), `InvalidUploadStateException` (`INVALID_UPLOAD_STATE`, 409), `InvalidUploadPartsException` (`INVALID_UPLOAD_PARTS`, 400), `UploadSizeMismatchException` (`UPLOAD_SIZE_MISMATCH`, 422), `VideoNotReadyException` (`VIDEO_NOT_READY`, 409) — códigos e status verbatim do `### Error Catalog`
2. Adicionar `findByUserId(userId: string): Promise<Channel | null>` em `src/channels/channels.service.ts` (`findOne` com `where: { user_id: userId }`; ausência retorna `null`, quem chama decide a exceção — per `.claude/rules/typeorm-queries.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `DomainExceptionFilter` (novas exceções) | Unit: cada exceção mapeia para `{ statusCode, error, message }` correto | `src/common/filters/domain-exception.filter.spec.ts` |
| `ChannelsService.findByUserId` | Integration: canal existente e usuário sem canal | `src/channels/channels.service.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Cada nova exceção, quando lançada em um handler, produz resposta com o `statusCode` e o `error` do Error Catalog (ex.: `VideoTooLargeException` → `413` com `error: "VIDEO_TOO_LARGE"`)
- `findByUserId` de um usuário registrado devolve o canal criado no cadastro; para um `userId` sem canal devolve `null`

---

### SI-03.7 — QueueModule e producer da fila de processamento

**Description:** Configurar a conexão BullMQ/Redis compartilhada por API e worker e criar o producer que enfileira o processamento de um vídeo de forma idempotente.

**Technical actions:**

1. Criar `src/queue/queue.module.ts` — `BullModule.forRootAsync` com `inject: [queueConfig.KEY]`, `connection: { host: redisHost, port: redisPort }` e `prefix` da config (host é o serviço `redis`, nunca `localhost`); exportar `BullModule` (per `phase-03-videos/TD-01`)
2. Criar `src/videos/video-processing.constants.ts` — `VIDEO_PROCESSING_QUEUE = 'video-processing'` e `PROCESS_VIDEO_JOB = 'process-video'`
3. Criar `src/videos/video-processing.producer.ts` — `VideoProcessingProducer.enqueue(videoId)` com `@InjectQueue(VIDEO_PROCESSING_QUEUE)`: `queue.add(PROCESS_VIDEO_JOB, { videoId }, { jobId: videoId, attempts, backoff: { type: 'exponential', delay: backoffMs }, removeOnComplete: true })` com `attempts`/`backoffMs` de `queueConfig` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-08`; `jobId` repetido não duplica o job — ver `library-refs.md` → `bullmq`)
4. Registrar `BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE })` e `VideoProcessingProducer` em `VideosModule` (com `exports: [VideoProcessingProducer]`) e importar `QueueModule` em `src/app.module.ts`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingProducer` | Integration (Redis real, `QUEUE_PREFIX` único por execução para não ser consumido pelo worker do Compose): job criado com payload `{ videoId }`, `attempts` e backoff exponencial; duas chamadas com o mesmo `videoId` resultam em um único job | `src/videos/video-processing.producer.integration-spec.ts` |
| `QueueModule` | Unit: compilação do módulo com `ConfigModule` global e `queueConfig` | `src/queue/queue.module.spec.ts` |

**Dependencies:** SI-03.1, SI-03.2

**Acceptance criteria:**

- Após `enqueue(videoId)`, a fila `video-processing` do Redis contém um job `process-video` com `data.videoId` igual ao informado e `opts.jobId` igual ao `videoId`
- O job criado carrega `attempts` e `backoff` exponencial com os valores de `VIDEO_PROCESSING_ATTEMPTS` e `VIDEO_PROCESSING_BACKOFF_MS`
- Chamar `enqueue` duas vezes para o mesmo `videoId` mantém um único job na fila
- Com `QUEUE_PREFIX` diferente do default, o job não aparece na fila do prefixo `streamtube`

---

### SI-03.8 — VideosService: posse, transições de status e DTO de resposta

**Description:** Concentrar em `VideosService` a leitura com checagem de posse e as transições de `processing_status`, para que uploads, entrega e worker usem uma única fonte de regras sobre a entidade `Video`.

**Technical actions:**

1. Criar `src/videos/videos.service.ts` — `findOwnedByPublicId(publicId, userId)` (`findOne` com `where: { public_id, channel: { user_id: userId } }`; ausente → `VideoNotFoundException`, cobrindo vídeo inexistente e de outro usuário) e `findById(id): Promise<Video | null>` para o worker
2. Em `VideosService`, adicionar transições condicionais via `repository.update({ id, processing_status: <esperado> }, {...})` retornando `boolean` por `affected > 0`: `markProcessing(id)` (`uploading → processing`, zera `upload_id`), `markReady(id, metadata)` (`processing → ready`, grava `duration_seconds`, `width`, `height`, `video_codec`, `format_name`, `thumbnail_key`, limpa `failure_reason`) e `markFailed(id, reason)` (qualquer status não terminal → `failed`, `failure_reason` truncado a 500 caracteres) (per `phase-03-videos/TD-08`)
3. Criar `src/videos/dto/video-response.dto.ts` — `VideoResponseDto` com `static from(video)` mapeando as propriedades `snake_case` da entidade para o JSON `camelCase` de `GET /videos/:publicId` (`hasThumbnail = thumbnail_key !== null`; `id` interno e `upload_id` nunca incluídos)
4. Registrar e exportar `VideosService` em `VideosModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: ramificações de `findOwnedByPublicId` (encontrado / `VideoNotFoundException`) e retorno `boolean` das transições (mock do repositório) | `src/videos/videos.service.spec.ts` |
| `VideosService` | Integration (DB real): posse por `channel.user_id`; `markProcessing → markReady` com metadados persistidos; transição fora de ordem retorna `false` e não altera a linha; `markFailed` grava motivo truncado | `src/videos/videos.service.integration-spec.ts` |
| `VideoResponseDto.from` | Unit: mapeamento `camelCase`, `hasThumbnail`, ausência de `id`/`upload_id` | `src/videos/dto/video-response.dto.spec.ts` |

**Dependencies:** SI-03.4, SI-03.6

**Acceptance criteria:**

- `findOwnedByPublicId` com o `publicId` de um vídeo do próprio usuário devolve o vídeo; com `publicId` inexistente ou de vídeo de outro usuário lança `VideoNotFoundException`
- Chamar `markProcessing` em um vídeo ainda em `uploading` não altera o status e retorna `false`
- Após `markProcessing` → `markReady`, a linha tem `processing_status = 'ready'`, metadados preenchidos e `failure_reason` nulo
- `markFailed` com motivo de 800 caracteres persiste `failure_reason` com no máximo 500
- O JSON de `VideoResponseDto.from` não contém as chaves `id` nem `uploadId`

---

### SI-03.9 — Início do upload: pré-cadastro do rascunho e sessão multipart

**Description:** Implementar em `VideoUploadsService` o início do upload — cria o vídeo como rascunho com URL única e abre o multipart no storage, com compensação se o cadastro falhar.

**Technical actions:**

1. Criar `src/videos/dto/initiate-upload.dto.ts` (`filename`, `contentType`, `size`) e `src/videos/dto/upload-session-response.dto.ts` conforme `### API Contracts → POST /videos`, com as validações de `#### Validation Rules — Upload` (`@IsString`, `@Length(1, 255)`, `@Matches`, `@IsInt`, `@Min(1)`)
2. Criar `src/videos/video-uploads.service.ts` — `initiate(userId, dto)`: resolve o canal por `ChannelsService.findByUserId` (ausente → `ChannelNotFoundException`), rejeita `size > videoConfig.maxSizeBytes` com `VideoTooLargeException`, gera `id` (`randomUUID`) e `storage_key = STORAGE_KEYS.videoOriginal(id)`, calcula `partSize = videoConfig.partSizeBytes` e `partCount = ceil(size / partSize)` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`)
3. Em `initiate`, chamar `StorageService.createMultipartUpload` e então inserir o `Video` (`title` = nome do arquivo sem extensão truncado a 255, `processing_status = 'uploading'`, `upload_id`, `part_size_bytes`, `public_id = generatePublicId()`), repetindo a geração do `public_id` até 5 vezes em violação de unicidade `23505` sobre `public_id` (insert avulso, sem transação — sem necessidade de SAVEPOINT) (per `phase-03-videos/TD-06`; `.claude/rules/typeorm-queries.md`)
4. Se o insert falhar por qualquer erro que não seja a colisão tratada, chamar `StorageService.abortMultipartUpload` (compensação) e relançar o erro original — o serviço nunca engole exceções (per `.claude/rules/nestjs-services.md`)
5. Importar `ChannelsModule` e `StorageModule` em `VideosModule` e registrar `VideoUploadsService` (sem exportar)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoUploadsService.initiate` | Unit: tamanho acima do limite, canal ausente, retry de `public_id` em colisão (mock de repo/storage), compensação com `abortMultipartUpload` quando o insert falha | `src/videos/video-uploads.service.spec.ts` |
| `VideoUploadsService.initiate` | Integration (PostgreSQL + MinIO reais): vídeo `uploading` com `upload_id` válido (uma parte enviada com sucesso pelo `uploadId` devolvido) e `part_size_bytes` persistidos; compensação real quando o insert é forçado a falhar (upload abortado: `listParts` falha) | `src/videos/video-uploads.service.integration-spec.ts` |

**Dependencies:** SI-03.3, SI-03.4, SI-03.5, SI-03.6, SI-03.8

**Acceptance criteria:**

- `initiate` com `size` de 10 GiB + 1 byte lança `VideoTooLargeException` e não cria linha nem upload no storage
- `initiate` válido persiste um `Video` com `processing_status = 'uploading'`, `publication_status = 'draft'`, `public_id` de 11 caracteres e `title` igual ao nome do arquivo sem extensão
- `partCount` devolvido é `ceil(size / partSize)` (ex.: `size` de 12 MiB com partes de 5 MiB → `3`)
- Quando o insert do vídeo falha, o multipart recém-aberto é abortado e o erro original é propagado
- Usuário sem canal recebe `ChannelNotFoundException`

---

### SI-03.10 — Handshake de upload: URLs de partes, retomada e conclusão

**Description:** Completar `VideoUploadsService` com URLs pré-assinadas por parte, listagem de partes para retomada e a conclusão idempotente que verifica o objeto, transiciona para `processing` e enfileira o processamento.

**Technical actions:**

1. Criar `src/videos/dto/presign-parts.dto.ts` e `src/videos/dto/complete-upload.dto.ts` conforme `### API Contracts` (`partNumbers`: `@IsInt({ each: true })`, `@ArrayMinSize(1)`, `@ArrayMaxSize(100)`, `@ArrayUnique`; `parts[]` aninhado com `@ValidateNested` + `@Type`), mais os DTOs de resposta `PresignedPartsResponseDto`, `UploadedPartsResponseDto` e `UploadAcceptedResponseDto`
2. Em `VideoUploadsService`, `presignParts(userId, publicId, partNumbers)`: carrega via `VideosService.findOwnedByPublicId`, exige `processing_status = 'uploading'` (`InvalidUploadStateException`), rejeita `partNumber > partCount` (`InvalidUploadPartsException`) e devolve as URLs de `StorageService.presignUploadPart` com `videoConfig.partUrlTtlSeconds` (per `phase-03-videos/TD-02`)
3. Em `VideoUploadsService`, `listUploadedParts(userId, publicId)`: mesmo guard de estado (`uploading`) e retorno de `StorageService.listParts` com `partSize`/`partCount` do vídeo
4. Em `VideoUploadsService`, `complete(userId, publicId, parts)`: se o status já for `processing`/`ready` devolve o estado atual (re-enfileirando via `VideoProcessingProducer.enqueue` apenas em `processing`, seguro por `jobId`); `failed` → `InvalidUploadStateException`; em `uploading` valida que `parts` cobre exatamente `1..partCount` (`InvalidUploadPartsException`), chama `StorageService.completeMultipartUpload`, confere `headObject().ContentLength === size_bytes` (divergência → remove o objeto, `markFailed('upload size mismatch')`, `UploadSizeMismatchException`), executa `VideosService.markProcessing` (`uploading → processing`) e `enqueue` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-08`)
5. Em `complete`, tratar `NoSuchUpload` do storage reconsultando o vídeo: se outro request concorrente já concluiu (status deixou de ser `uploading`) responder como idempotente, caso contrário relançar o erro

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoUploadsService` (`presignParts`, `listUploadedParts`, `complete`) | Unit: guards de estado, numeração de partes, idempotência, divergência de tamanho (mocks de storage/producer/`VideosService`) | `src/videos/video-uploads.service.spec.ts` |
| `VideoUploadsService` (fluxo completo) | Integration (PostgreSQL + MinIO + Redis reais, `QUEUE_PREFIX` único e `VIDEO_PART_SIZE_BYTES=5242880`): multipart de 2 partes por URL pré-assinada → `listUploadedParts` → `complete` → `processing` + job na fila; `complete` repetido mantém um job; objeto com tamanho divergente → `failed` + `UploadSizeMismatchException` | `src/videos/video-uploads.service.integration-spec.ts` |

**Dependencies:** SI-03.7, SI-03.9

**Acceptance criteria:**

- `presignParts` com `partNumber` maior que `partCount` lança `InvalidUploadPartsException`; com o vídeo fora de `uploading` lança `InvalidUploadStateException`
- Após enviar 2 partes pelas URLs devolvidas, `listUploadedParts` retorna as partes `1` e `2` com `etag`
- `complete` com todas as partes muda o vídeo para `processing`, zera `upload_id` e deixa exatamente um job `process-video` com `jobId` igual ao id interno do vídeo
- `complete` chamado uma segunda vez devolve o status atual sem criar novo job nem erro
- `complete` com lista de partes incompleta ou com lacuna lança `InvalidUploadPartsException` e mantém o vídeo em `uploading`
- Objeto no storage com `ContentLength` diferente de `size_bytes` resulta em `UploadSizeMismatchException`, objeto removido e vídeo `failed`

---

### SI-03.11 — Endpoint POST /videos

**Route:** POST /videos
**Test Specs:** see `nestjs-project/specs/videos-initiate-upload.plan.md`
**Authorization:** Authenticated (cria o vídeo no canal do próprio usuário)

**Description:** Expor o início do upload: cria o rascunho do vídeo e devolve a sessão multipart, além de plugar o `VideosModule` na aplicação.

**Technical actions:**

1. Criar `src/videos/video-uploads.controller.ts` — `@ApiTags('videos') @Controller('videos')`, handler `initiate(@CurrentUser() user, @Body() dto: InitiateUploadDto)` com `@Post()` + `@HttpCode(201)`, apenas delegando a `VideoUploadsService.initiate(user.sub, dto)` (per `phase-03-videos/TD-02`)
2. Documentar o handler per `.claude/rules/nestjs-controllers.md`: `@ApiBearerAuth('access-token')`, `@ApiOperation`, `@ApiResponse` para `201` (`UploadSessionResponseDto`) e para `400`, `401`, `404`, `413` referenciando `ApiErrorEnvelope` via `getSchemaPath`
3. Registrar `VideoUploadsController` em `VideosModule` (`controllers`) e importar `VideosModule` em `src/app.module.ts`

**Tests:** _(empty — E2E authored by /plan-test-specs spec; real MinIO/Redis/worker)_

**Dependencies:** SI-03.9

**Acceptance criteria:**

- `POST /videos` autenticado com `{ filename: "aula.mp4", contentType: "video/mp4", size: 12582912 }` retorna `201` com `publicId` de 11 caracteres, `processingStatus: "uploading"`, `publicationStatus: "draft"`, `title: "aula"` e `upload.uploadId`, `upload.partSize`, `upload.partCount`
- `POST /videos` com `size: 10737418241` retorna `413` com `error: "VIDEO_TOO_LARGE"`
- `POST /videos` com `contentType: "image/png"` retorna `400` com `error: "VALIDATION_ERROR"`
- `POST /videos` com propriedade desconhecida no corpo retorna `400` com `error: "VALIDATION_ERROR"`
- `POST /videos` sem `Authorization` retorna `401`

---

### SI-03.12 — Endpoint POST /videos/:publicId/upload/parts

**Route:** POST /videos/:publicId/upload/parts
**Test Specs:** see `nestjs-project/specs/videos-upload-parts.plan.md`
**Authorization:** Owner

**Description:** Expor a emissão de URLs pré-assinadas para as partes do upload multipart.

**Technical actions:**

1. Adicionar o handler `presignParts(@CurrentUser() user, @Param('publicId') publicId, @Body() dto: PresignPartsDto)` em `VideoUploadsController` com `@Post(':publicId/upload/parts')` + `@HttpCode(200)` (o POST não cria recurso persistido), delegando a `VideoUploadsService.presignParts` (per `phase-03-videos/TD-02`)
2. Documentar o handler: `@ApiBearerAuth('access-token')`, `@ApiOperation`, `@ApiResponse` para `200` (`PresignedPartsResponseDto`) e para `400`, `401`, `404`, `409` com `ApiErrorEnvelope`

**Tests:** _(empty — E2E authored by /plan-test-specs spec; real MinIO/Redis/worker)_

**Dependencies:** SI-03.10, SI-03.11

**Acceptance criteria:**

- `POST /videos/:publicId/upload/parts` do dono com `{ partNumbers: [1, 2] }` retorna `200` com `parts` contendo `partNumber` e `url` para cada número, e um `PUT` de bytes em cada `url` é aceito pelo MinIO devolvendo `ETag`
- `POST /videos/:publicId/upload/parts` com `partNumbers` contendo número maior que `partCount` retorna `400` com `error: "INVALID_UPLOAD_PARTS"`
- `POST /videos/:publicId/upload/parts` com `partNumbers: []` retorna `400` com `error: "VALIDATION_ERROR"`
- `POST /videos/:publicId/upload/parts` de outro usuário autenticado retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `POST /videos/:publicId/upload/parts` para vídeo já em `processing` retorna `409` com `error: "INVALID_UPLOAD_STATE"`
- `POST /videos/:publicId/upload/parts` sem `Authorization` retorna `401`

---

### SI-03.13 — Endpoint GET /videos/:publicId/upload

**Route:** GET /videos/:publicId/upload
**Test Specs:** see `nestjs-project/specs/videos-upload-status.plan.md`
**Authorization:** Owner

**Description:** Expor as partes já recebidas pelo storage para que o cliente retome um upload interrompido.

**Technical actions:**

1. Adicionar o handler `listUploadedParts(@CurrentUser() user, @Param('publicId') publicId)` em `VideoUploadsController` com `@Get(':publicId/upload')`, delegando a `VideoUploadsService.listUploadedParts` (per `phase-03-videos/TD-02`)
2. Documentar o handler: `@ApiBearerAuth('access-token')`, `@ApiOperation`, `@ApiResponse` para `200` (`UploadedPartsResponseDto`) e para `401`, `404`, `409` com `ApiErrorEnvelope`

**Tests:** _(empty — E2E authored by /plan-test-specs spec; real MinIO/Redis/worker)_

**Dependencies:** SI-03.10, SI-03.11

**Acceptance criteria:**

- `GET /videos/:publicId/upload` do dono logo após `POST /videos` retorna `200` com `parts: []`, `partSize` e `partCount`
- Depois de enviar a parte `1` ao MinIO, `GET /videos/:publicId/upload` retorna `parts` com `partNumber: 1`, `size` e `etag` dessa parte
- `GET /videos/:publicId/upload` de vídeo já em `processing` retorna `409` com `error: "INVALID_UPLOAD_STATE"`
- `GET /videos/:publicId/upload` de outro usuário autenticado retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `GET /videos/:publicId/upload` sem `Authorization` retorna `401`

---

### SI-03.14 — Endpoint POST /videos/:publicId/upload/complete

**Route:** POST /videos/:publicId/upload/complete
**Test Specs:** see `nestjs-project/specs/videos-upload-complete.plan.md`
**Authorization:** Owner

**Description:** Expor a conclusão do upload: finaliza o multipart, verifica o objeto e dispara o processamento em segundo plano.

**Technical actions:**

1. Adicionar o handler `complete(@CurrentUser() user, @Param('publicId') publicId, @Body() dto: CompleteUploadDto)` em `VideoUploadsController` com `@Post(':publicId/upload/complete')` + `@HttpCode(202)`, delegando a `VideoUploadsService.complete` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-01`)
2. Documentar o handler: `@ApiBearerAuth('access-token')`, `@ApiOperation`, `@ApiResponse` para `202` (`UploadAcceptedResponseDto`) e para `400`, `401`, `404`, `409`, `422` com `ApiErrorEnvelope`

**Tests:** _(empty — E2E authored by /plan-test-specs spec; real MinIO/Redis/worker)_

**Dependencies:** SI-03.10, SI-03.11

**Acceptance criteria:**

- `POST /videos/:publicId/upload/complete` com todas as partes enviadas e seus `etag` retorna `202` com `processingStatus: "processing"` (ou o status já avançado pelo worker)
- Chamar `POST /videos/:publicId/upload/complete` novamente para o mesmo vídeo retorna `202` sem erro
- `POST /videos/:publicId/upload/complete` com menos partes que `partCount` retorna `400` com `error: "INVALID_UPLOAD_PARTS"`
- `POST /videos/:publicId/upload/complete` com `parts` sem `etag` retorna `400` com `error: "VALIDATION_ERROR"`
- `POST /videos/:publicId/upload/complete` quando o objeto tem tamanho diferente do declarado retorna `422` com `error: "UPLOAD_SIZE_MISMATCH"`
- `POST /videos/:publicId/upload/complete` de outro usuário autenticado retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `POST /videos/:publicId/upload/complete` sem `Authorization` retorna `401`

---

### SI-03.15 — VideoDeliveryService: URLs de streaming, download e thumbnail

**Description:** Criar o serviço que autoriza o dono e resolve as URLs pré-assinadas de entrega, mantendo a API fora do caminho dos bytes.

**Technical actions:**

1. Criar `src/videos/video-delivery.service.ts` — `getStreamUrl(userId, publicId)`: carrega via `VideosService.findOwnedByPublicId`, exige `processing_status = 'ready'` (`VideoNotReadyException`) e devolve `StorageService.presignGetObject(storage_key, { expiresIn: videoConfig.streamUrlTtlSeconds })` (per `phase-03-videos/TD-07`)
2. Em `VideoDeliveryService`, `getDownloadUrl(userId, publicId)`: mesmas regras, passando `downloadFilename: original_filename` para forçar `Content-Disposition: attachment` (per `phase-03-videos/TD-07`)
3. Em `VideoDeliveryService`, `getThumbnailUrl(userId, publicId)`: exige `thumbnail_key` não nulo (`VideoNotReadyException` caso contrário) e assina a chave da thumbnail com o mesmo TTL
4. Registrar `VideoDeliveryService` em `VideosModule` (providers)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoDeliveryService` | Unit: ramificações de estado (`ready` vs demais), thumbnail ausente, `downloadFilename` repassado só no download (mocks de storage/`VideosService`) | `src/videos/video-delivery.service.spec.ts` |
| `VideoDeliveryService` | Integration (PostgreSQL + MinIO reais): objeto real no bucket; URL de stream com `Range: bytes=0-9` devolve `206`; URL de download traz `Content-Disposition: attachment`; URL de thumbnail devolve `image/jpeg` | `src/videos/video-delivery.service.integration-spec.ts` |

**Dependencies:** SI-03.3, SI-03.8

**Acceptance criteria:**

- Para vídeo `ready` do próprio usuário, `getStreamUrl` devolve uma URL cujo `GET` com `Range: bytes=0-9` retorna `206` com 10 bytes
- `getDownloadUrl` devolve uma URL cuja resposta contém `Content-Disposition` com `attachment` e o nome original do arquivo
- `getStreamUrl`, `getDownloadUrl` e `getThumbnailUrl` em vídeo que não está `ready` lançam `VideoNotReadyException`
- Em vídeo de outro usuário os três métodos lançam `VideoNotFoundException`

---

### SI-03.16 — Endpoint GET /videos/:publicId

**Route:** GET /videos/:publicId
**Test Specs:** see `nestjs-project/specs/videos-get.plan.md`
**Authorization:** Owner

**Description:** Expor os dados e o status de processamento do vídeo para o dono acompanhar o upload até `ready`/`failed`.

**Technical actions:**

1. Criar `src/videos/videos.controller.ts` — `@ApiTags('videos') @Controller('videos')`, handler `findOne(@CurrentUser() user, @Param('publicId') publicId)` com `@Get(':publicId')` retornando `VideoResponseDto.from(await videosService.findOwnedByPublicId(publicId, user.sub))`; sem lógica de negócio no controller
2. Documentar o handler: `@ApiBearerAuth('access-token')`, `@ApiOperation`, `@ApiResponse` para `200` (`VideoResponseDto`) e para `401`, `404` com `ApiErrorEnvelope`
3. Registrar `VideosController` em `VideosModule` (`controllers`)

**Tests:** _(empty — E2E authored by /plan-test-specs spec; real MinIO/Redis/worker)_

**Dependencies:** SI-03.8, SI-03.11

**Acceptance criteria:**

- `GET /videos/:publicId` do dono logo após `POST /videos` retorna `200` com `processingStatus: "uploading"`, `publicationStatus: "draft"`, `hasThumbnail: false`, `durationSeconds: null` e sem chave `id`
- Após o processamento concluir, `GET /videos/:publicId` retorna `processingStatus: "ready"`, `durationSeconds` numérico, `width`, `height`, `videoCodec`, `formatName` e `hasThumbnail: true`
- `GET /videos/:publicId` com `publicId` inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `GET /videos/:publicId` de outro usuário autenticado retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `GET /videos/:publicId` sem `Authorization` retorna `401`

---

### SI-03.17 — Endpoint GET /videos/:publicId/stream

**Route:** GET /videos/:publicId/stream
**Test Specs:** see `nestjs-project/specs/videos-stream.plan.md`
**Authorization:** Owner

**Description:** Expor a reprodução em streaming: a API autoriza o dono e redireciona para o storage, que serve `Range`/`206`.

**Technical actions:**

1. Adicionar o handler `stream(@CurrentUser() user, @Param('publicId') publicId)` em `VideosController` com `@Get(':publicId/stream')` + `@Redirect()` retornando `{ url, statusCode: 302 }` a partir de `VideoDeliveryService.getStreamUrl(user.sub, publicId)` (per `phase-03-videos/TD-07`)
2. Documentar o handler: `@ApiBearerAuth('access-token')`, `@ApiOperation`, `@ApiResponse` para `302` (header `Location`, sem `schema`) e para `401`, `404`, `409` com `ApiErrorEnvelope`

**Tests:** _(empty — E2E authored by /plan-test-specs spec; real MinIO/Redis/worker)_

**Dependencies:** SI-03.15, SI-03.16

**Acceptance criteria:**

- `GET /videos/:publicId/stream` do dono com vídeo `ready` retorna `302` com `Location` apontando para o MinIO
- Um `GET` na URL de `Location` com `Range: bytes=0-1023` retorna `206` com `Content-Range` e 1024 bytes
- `GET /videos/:publicId/stream` com vídeo ainda não `ready` retorna `409` com `error: "VIDEO_NOT_READY"`
- `GET /videos/:publicId/stream` de outro usuário autenticado retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `GET /videos/:publicId/stream` sem `Authorization` retorna `401`

---

### SI-03.18 — Endpoint GET /videos/:publicId/download

**Route:** GET /videos/:publicId/download
**Test Specs:** see `nestjs-project/specs/videos-download.plan.md`
**Authorization:** Owner

**Description:** Expor o download do vídeo original: a API autoriza o dono e redireciona para uma URL do storage que força `Content-Disposition: attachment`.

**Technical actions:**

1. Adicionar o handler `download(@CurrentUser() user, @Param('publicId') publicId)` em `VideosController` com `@Get(':publicId/download')` + `@Redirect()` retornando `{ url, statusCode: 302 }` a partir de `VideoDeliveryService.getDownloadUrl(user.sub, publicId)` (per `phase-03-videos/TD-07`)
2. Documentar o handler: `@ApiBearerAuth('access-token')`, `@ApiOperation`, `@ApiResponse` para `302` (header `Location`, sem `schema`) e para `401`, `404`, `409` com `ApiErrorEnvelope`

**Tests:** _(empty — E2E authored by /plan-test-specs spec; real MinIO/Redis/worker)_

**Dependencies:** SI-03.15, SI-03.16

**Acceptance criteria:**

- `GET /videos/:publicId/download` do dono com vídeo `ready` retorna `302` com `Location` apontando para o MinIO
- A resposta do MinIO à URL de `Location` traz `Content-Disposition` com `attachment` e o `original_filename` do vídeo, e o corpo baixado tem `size_bytes` bytes
- `GET /videos/:publicId/download` com vídeo ainda não `ready` retorna `409` com `error: "VIDEO_NOT_READY"`
- `GET /videos/:publicId/download` de outro usuário autenticado retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `GET /videos/:publicId/download` sem `Authorization` retorna `401`

---

### SI-03.19 — Endpoint GET /videos/:publicId/thumbnail

**Route:** GET /videos/:publicId/thumbnail
**Test Specs:** see `nestjs-project/specs/videos-thumbnail.plan.md`
**Authorization:** Owner

**Description:** Expor a thumbnail gerada pelo worker via redirecionamento para URL pré-assinada do storage privado.

**Technical actions:**

1. Adicionar o handler `thumbnail(@CurrentUser() user, @Param('publicId') publicId)` em `VideosController` com `@Get(':publicId/thumbnail')` + `@Redirect()` retornando `{ url, statusCode: 302 }` a partir de `VideoDeliveryService.getThumbnailUrl(user.sub, publicId)` (per `phase-03-videos/TD-03`)
2. Documentar o handler: `@ApiBearerAuth('access-token')`, `@ApiOperation`, `@ApiResponse` para `302` (header `Location`, sem `schema`) e para `401`, `404`, `409` com `ApiErrorEnvelope`

**Tests:** _(empty — E2E authored by /plan-test-specs spec; real MinIO/Redis/worker)_

**Dependencies:** SI-03.15, SI-03.16

**Acceptance criteria:**

- `GET /videos/:publicId/thumbnail` do dono com vídeo `ready` retorna `302` e a URL de `Location` responde `200` com `Content-Type: image/jpeg`
- `GET /videos/:publicId/thumbnail` com vídeo sem thumbnail (ainda não processado) retorna `409` com `error: "VIDEO_NOT_READY"`
- `GET /videos/:publicId/thumbnail` de outro usuário autenticado retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `GET /videos/:publicId/thumbnail` sem `Authorization` retorna `401`

---

### SI-03.20 — MediaModule: ffprobe e ffmpeg sobre URL pré-assinada

**Description:** Isolar em um módulo a invocação de `ffprobe`/`ffmpeg` sobre a URL pré-assinada do objeto (sem baixar o arquivo), classificando falhas como recuperáveis ou não.

**Technical actions:**

1. Criar `src/media/media.types.ts` (`MediaMetadata`: `durationSeconds`, `width`, `height`, `videoCodec`, `formatName`) e `MediaProcessingError` (`extends Error`, campo `retryable: boolean`) e `src/media/media.constants.ts` (timeouts de `ffprobe`/`ffmpeg`, argumentos fixos)
2. Criar `src/media/media-tools.service.ts` — `probe(url): Promise<MediaMetadata>` com `child_process.spawn('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', url])` (array de argumentos, sem shell), parse do JSON e escolha do primeiro stream `codec_type === 'video'`; ausência de stream de vídeo ou saída "Invalid data found" → `MediaProcessingError` com `retryable: false`; erro de rede/HTTP, `ENOENT`, timeout → `retryable: true` (per `phase-03-videos/TD-05`)
3. Em `MediaToolsService`, `extractThumbnail(url, atSeconds): Promise<Buffer>` com `spawn('ffmpeg', ['-ss', String(atSeconds), '-i', url, '-frames:v', '1', '-vf', 'scale=640:-2', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'])` coletando stdout; saída vazia → `MediaProcessingError` (per `phase-03-videos/TD-05`)
4. Criar `src/media/media.module.ts` exportando `MediaToolsService`
5. Criar `src/test/generate-test-video.ts` — gera com `ffmpeg -f lavfi -i testsrc=duration=2:size=320x240:rate=15 -pix_fmt yuv420p` um MP4 válido em diretório temporário e devolve o `Buffer` (sem binários versionados no repositório)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `MediaToolsService` | Integration (ffprobe/ffmpeg reais + MinIO real, mídia servida por URL pré-assinada): `probe` devolve duração ≈ 2 s, `320x240`, codec `h264`; `extractThumbnail` devolve JPEG (bytes `FF D8`); arquivo que não é vídeo → `retryable: false`; URL inexistente → `retryable: true` | `src/media/media-tools.service.integration-spec.ts` |
| `MediaModule` | Unit: compilação do módulo | `src/media/media.module.spec.ts` |

**Dependencies:** SI-03.1, SI-03.3

**Acceptance criteria:**

- `probe` de um MP4 de 2 segundos 320x240 servido pelo MinIO devolve `width: 320`, `height: 240`, `durationSeconds` entre 1.9 e 2.1 e `videoCodec: "h264"`
- `extractThumbnail` do mesmo objeto devolve um `Buffer` que começa com os bytes `0xFF 0xD8` (JPEG)
- `probe` de um objeto com bytes aleatórios lança `MediaProcessingError` com `retryable: false`
- `probe` de uma URL de objeto inexistente lança `MediaProcessingError` com `retryable: true`

---

### SI-03.21 — VideoProcessingService: metadados e thumbnail

**Description:** Implementar a orquestração do processamento de um vídeo (probe, thumbnail, persistência e transição para `ready`), independente do BullMQ, para ser testada com a infraestrutura real.

**Technical actions:**

1. Criar `src/video-processing/video-processing.service.ts` — `process(videoId)`: carrega via `VideosService.findById`; vídeo inexistente ou em estado que não seja `processing` (já `ready`/`failed`, ou ainda `uploading`) → retorna sem efeito (idempotência por at-least-once); o worker parte de `processing` e não chama `markProcessing`; gera `StorageService.presignGetObject(storage_key, { expiresIn: 3600 })` (per `phase-03-videos/TD-04`, `phase-03-videos/TD-05`)
2. Em `process`, executar `MediaToolsService.probe(url)` e `extractThumbnail(url, Math.min(1, durationSeconds / 2))`, gravar o JPEG com `StorageService.putObject(STORAGE_KEYS.videoThumbnail(id), buffer, 'image/jpeg')` e concluir com `VideosService.markReady(id, { ...metadata, thumbnail_key })` (per `phase-03-videos/TD-05`)
3. Converter `MediaProcessingError` com `retryable: false` em `UnrecoverableError` de `bullmq` (sem retentativas); demais erros propagam inalterados para o mecanismo de retry (per `phase-03-videos/TD-08`; ver `library-refs.md` → `bullmq`)
4. Em `VideoProcessingService`, expor `failPermanently(videoId, reason)` delegando a `VideosService.markFailed` — usado pelo handler de falha do processor (SI-03.22)
5. Criar `src/video-processing/video-processing.module.ts` importando `VideosModule`, `StorageModule` e `MediaModule`, com `providers: [VideoProcessingService]` e `exports: [VideoProcessingService]`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingService` | Unit: idempotência (vídeo `ready`/inexistente), mapeamento `retryable: false` → `UnrecoverableError`, propagação de erro recuperável (mocks) | `src/video-processing/video-processing.service.spec.ts` |
| `VideoProcessingService` | Integration (PostgreSQL + MinIO + ffmpeg reais, sem fila): MP4 gerado enviado ao bucket → `process` deixa o vídeo `ready` com metadados e `thumbnail_key` apontando para um JPEG existente; arquivo inválido → `UnrecoverableError` e vídeo sem metadados | `src/video-processing/video-processing.service.integration-spec.ts` |
| `VideoProcessingModule` | Unit: compilação do módulo | `src/video-processing/video-processing.module.spec.ts` |

**Dependencies:** SI-03.8, SI-03.20

**Acceptance criteria:**

- Após `process` de um MP4 válido de 2 s, o vídeo tem `processing_status = 'ready'`, `duration_seconds` ≈ 2, `width = 320`, `height = 240`, `video_codec = 'h264'` e `thumbnail_key = videos/{id}/thumbnail.jpg`
- O objeto `videos/{id}/thumbnail.jpg` existe no bucket com `ContentType` `image/jpeg`
- `process` chamado de novo para um vídeo já `ready` não altera a linha nem regrava a thumbnail
- `process` de um objeto que não é vídeo lança `UnrecoverableError` e o vídeo não chega a `ready`

---

### SI-03.22 — Worker de vídeo: processor BullMQ, retry/falha e entrypoint separado

**Description:** Ligar o `VideoProcessingService` à fila com retentativas e tratamento de falha definitiva, e criar o entrypoint e o `WorkerModule` que o serviço `video-worker` do Compose executa na mesma base de código da API.

**Technical actions:**

1. Criar `src/video-processing/video-processing.processor.ts` — `@Processor(VIDEO_PROCESSING_QUEUE)` estendendo `WorkerHost`, `process(job: Job<{ videoId: string }>)` delegando a `VideoProcessingService.process`; `@OnWorkerEvent('failed')` que, quando `error instanceof UnrecoverableError` **ou** `job.attemptsMade >= (job.opts.attempts ?? 1)`, chama `VideoProcessingService.failPermanently(videoId, error.message)` (único contexto em que capturar-e-logar sem relançar é permitido — per `.claude/rules/nestjs-services.md`, "Background tasks") (per `phase-03-videos/TD-01`, `phase-03-videos/TD-08`)
2. Registrar `VideoProcessingProcessor` e `BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE })` em `VideoProcessingModule` (o processor só é carregado no processo do worker, nunca no `AppModule` da API)
3. Extrair a configuração global hoje inline em `AppModule` (`ConfigModule.forRoot` com `load`/`validationSchema` e `TypeOrmModule.forRootAsync`) para `src/core/core.module.ts`, importado por `AppModule` e pelo `WorkerModule`, sem alterar comportamento (per `phase-01-configuracao-base/TD-01`, `phase-01-configuracao-base/TD-03`)
4. Criar `src/worker/worker.module.ts` (imports: `CoreModule`, `QueueModule`, `VideoProcessingModule`; sem controllers) e `src/worker.ts` com `NestFactory.createApplicationContext(WorkerModule)` + `app.enableShutdownHooks()` (per `phase-03-videos/TD-04`)
5. Adicionar em `package.json` os scripts `start:worker` (`node dist/worker`) e `start:worker:dev` (`nest start --watch --entryFile worker`), usado pelo serviço `video-worker` do Compose (SI-03.1)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingProcessor` | Integration (Redis, PostgreSQL, MinIO e ffmpeg reais; `QUEUE_PREFIX` único, `VIDEO_PROCESSING_BACKOFF_MS=50`): job de MP4 válido → `ready`; falha recuperável injetada com `jest.spyOn(MediaToolsService, 'probe')` na 1ª tentativa → `ready` após retry; falha em todas as tentativas → `failed` com `failure_reason`; arquivo inválido (`UnrecoverableError`) → `failed` sem esgotar tentativas | `src/video-processing/video-processing.processor.integration-spec.ts` |
| `WorkerModule` | Unit: compilação do módulo (sem controllers HTTP) | `src/worker/worker.module.spec.ts` |

**Dependencies:** SI-03.1, SI-03.7, SI-03.21

**Acceptance criteria:**

- Com o serviço `video-worker` de pé, um job `process-video` para um vídeo `processing` com MP4 válido no bucket deixa o vídeo `ready` com metadados e thumbnail
- Uma falha transitória na primeira tentativa não marca o vídeo como `failed`: o job é retentado com backoff e o vídeo chega a `ready`
- Esgotadas as `attempts` configuradas, o vídeo fica `failed` com `failure_reason` preenchido
- Um arquivo que não é vídeo leva o vídeo a `failed` sem consumir todas as tentativas
- `docker compose ps` mostra `video-worker` em execução e o processo não abre porta HTTP
- A API (`npm run start:dev`) continua iniciando e não registra o `VideoProcessingProcessor`

---

### SI-03.23 — E2E ponta a ponta com a infraestrutura real do Compose

**Description:** Cobrir a jornada completa — upload multipart direto ao MinIO, processamento pelo worker real e entrega por stream/download/thumbnail — sem mockar MinIO, Redis nem o worker.

**Technical actions:**

1. Criar `src/test/video-flow.ts` — helpers de e2e: registra, confirma e autentica um usuário (reaproveitando `AuthService`/`MailService` como em `test/auth.e2e-spec.ts`), executa o handshake completo via HTTP (`POST /videos` → `POST /videos/:publicId/upload/parts` → `PUT` nas URLs pré-assinadas → `POST /videos/:publicId/upload/complete`) e `waitForProcessing(publicId, token)` que faz polling em `GET /videos/:publicId` até `ready` ou `failed` (timeout 60 s); `cleanAllTables` e remoção do prefixo `videos/` do bucket em `afterAll`
2. Criar `test/videos-upload.e2e-spec.ts` — usa `AppModule` completo com as configurações globais de `main.ts` reproduzidas (`ValidationPipe`, `DomainExceptionFilter`, `ValidationExceptionFilter`) e o `QUEUE_PREFIX` default (consumido pelo `video-worker` do Compose); cobre: validação de DTOs, `413`, posse (`404` para outro usuário), `401` sem token, retomada via `GET /videos/:publicId/upload`, `complete` idempotente e `422` por tamanho divergente
3. Criar `test/videos-processing.e2e-spec.ts` — MP4 gerado por `generate-test-video.ts`, enviado em 2 partes (partes de 5 MiB via `VIDEO_PART_SIZE_BYTES`): após `complete`, o worker real leva o vídeo a `ready` com duração, dimensões, codec e thumbnail; arquivo de bytes aleatórios declarado como `video/mp4` termina `failed` com `failureReason`
4. Criar `test/videos-delivery.e2e-spec.ts` — com um vídeo `ready`: `GET .../stream` (`302` → `Range` retorna `206` com `Content-Range`), `GET .../download` (`302` → `Content-Disposition: attachment`, corpo com `size_bytes` bytes), `GET .../thumbnail` (`302` → `image/jpeg`); `409 VIDEO_NOT_READY` antes do processamento; `404` para outro usuário; `401` sem token (per `phase-03-videos/TD-07`)

_Pré-requisito de execução:_ `docker compose up -d` com `minio`, `minio-init`, `redis` e `video-worker` saudáveis; os e2e esperam o worker real e não o substituem.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `POST /videos`, `/upload/parts`, `GET /upload`, `/upload/complete` | E2E (supertest; PostgreSQL, MinIO, Redis e worker reais) | `test/videos-upload.e2e-spec.ts` |
| Pipeline `complete` → fila → worker → `ready`/`failed` | E2E (worker do Compose real, FFmpeg real) | `test/videos-processing.e2e-spec.ts` |
| `GET /videos/:publicId`, `/stream`, `/download`, `/thumbnail` | E2E (redirect `302` seguido contra o MinIO real, incluindo `Range`/`206`) | `test/videos-delivery.e2e-spec.ts` |

**Dependencies:** SI-03.14, SI-03.17, SI-03.18, SI-03.19, SI-03.22

**Acceptance criteria:**

- Um MP4 de 2 s enviado em 2 partes pela API e pelo MinIO chega a `processingStatus: "ready"` em até 60 s sem nenhum mock de MinIO, Redis ou worker
- Um arquivo de bytes aleatórios declarado como `video/mp4` termina com `processingStatus: "failed"` e `failureReason` preenchido
- O `Location` de `GET /videos/:publicId/stream` responde `206` a um pedido `Range: bytes=0-1023`
- O `Location` de `GET /videos/:publicId/download` responde com `Content-Disposition: attachment`
- Dois vídeos criados em sequência têm `publicId` distintos

---

### SI-03.24 — Contrato OpenAPI e coleção de requests de vídeos

**Description:** Regenerar o `openapi.json` versionado com os endpoints de vídeo e documentar o fluxo de upload na coleção `api.http`, mantendo o contrato consumido pelo frontend atualizado.

**Technical actions:**

1. Rodar `npm run openapi:export` e commitar o `nestjs-project/openapi.json` atualizado com as 8 operações de `### API Contracts` sob a tag `videos`, todas com `access-token` e respostas de erro via `ApiErrorEnvelope` (per `openapi-docs-nestjs/TD-02`)
2. Adicionar à `nestjs-project/api.http` a seção "VÍDEOS" com o fluxo na ordem: `POST /videos`, `POST /videos/{{publicId}}/upload/parts`, `PUT` na URL pré-assinada (comentário explicando a leitura do `ETag`), `GET /videos/{{publicId}}/upload`, `POST /videos/{{publicId}}/upload/complete`, `GET /videos/{{publicId}}` e os três `GET` de entrega
3. Estender `src/openapi-export.integration-spec.ts` (ou o spec de Swagger existente) para afirmar a presença das 8 operações de vídeo, de `ApiErrorEnvelope` nas respostas de erro e de `security: access-token` nelas

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Documento OpenAPI exportado (operações de `videos`) | Integration: paths/métodos, `security`, referência a `ApiErrorEnvelope` | `src/openapi-export.integration-spec.ts` |

**Dependencies:** SI-03.14, SI-03.16, SI-03.17, SI-03.18, SI-03.19

**Acceptance criteria:**

- O documento exportado contém `POST /videos`, `POST /videos/{publicId}/upload/parts`, `GET /videos/{publicId}/upload`, `POST /videos/{publicId}/upload/complete`, `GET /videos/{publicId}`, `GET /videos/{publicId}/stream`, `GET /videos/{publicId}/download` e `GET /videos/{publicId}/thumbnail`
- Todas as operações de vídeo declaram o esquema de segurança `access-token`
- Cada operação de vídeo referencia `ApiErrorEnvelope` em suas respostas de erro previstas
- `npm run openapi:export` não produz diff adicional em `openapi.json` após o commit

---

## Technical Specifications

### Data Model

#### Video

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated — usado internamente (chaves de storage, payload da fila); nunca exposto na API |
| public_id | varchar(11) | unique, not null — id aleatório URL-safe de 11 caracteres (per `phase-03-videos/TD-06`) |
| channel_id | uuid | FK → channels.id, not null — canal dono do vídeo |
| title | varchar(255) | not null — inicializado com o nome do arquivo sem extensão (edição é Fase 04) |
| original_filename | varchar(255) | not null — usado no `Content-Disposition` do download |
| content_type | varchar(100) | not null |
| size_bytes | bigint | not null — transformer `string → number` (10GB cabe com folga em `Number.MAX_SAFE_INTEGER`) |
| storage_key | varchar(255) | not null — `videos/{id}/original` (per `phase-03-videos/TD-03`) |
| upload_id | varchar(255) | nullable — `UploadId` do multipart S3; `null` após `complete` |
| part_size_bytes | integer | not null — tamanho de parte fixado no `initiate` (evita divergência se a config mudar antes do `complete`) |
| processing_status | enum `video_processing_status` | not null, default `'uploading'`, valores: `'uploading'`, `'processing'`, `'ready'`, `'failed'` (per `phase-03-videos/TD-08`) |
| publication_status | enum `video_publication_status` | not null, default `'draft'`, valores: `'draft'`, `'published'` — independente de `processing_status`; `'published'` só é atribuído na Fase 04 (per `phase-03-videos/TD-08`) |
| failure_reason | text | nullable — preenchido quando `processing_status = 'failed'` |
| duration_seconds | numeric(12,3) | nullable — transformer `string → number`; preenchido pelo worker |
| width | integer | nullable |
| height | integer | nullable |
| video_codec | varchar(50) | nullable |
| format_name | varchar(100) | nullable |
| thumbnail_key | varchar(255) | nullable — `videos/{id}/thumbnail.jpg` (per `phase-03-videos/TD-03`, `TD-05`) |
| created_at | timestamp | not null, `@CreateDateColumn` |
| updated_at | timestamp | not null, `@UpdateDateColumn` |

**Relations:** `Video` many-to-one `Channel` (owning side via `channel_id`); `Channel` one-to-many `Video` (lado inverso adicionado em `Channel`, sem mudança de schema)
**Indexes:** unique on `public_id`; `(channel_id)`; `(processing_status)`

**Ciclo de vida de `processing_status` (per `phase-03-videos/TD-08`):** `uploading` → `processing` (após `complete` verificado, que enfileira o job com `jobId = videoId`) → `ready` (metadados + thumbnail gravados) | `failed` (tentativas esgotadas ou erro irrecuperável, com `failure_reason`). Transições são condicionais (`UPDATE … WHERE processing_status = :esperado`) para tornar `complete` e o worker idempotentes.

**Decisões de build registradas:** (1) vídeo pertence a `Channel` (`channel_id`) e não direto a `User` — alinha com a Fase 04 (painel do canal); a posse é verificada por `channel.user_id`. (2) `part_size_bytes` persistido por vídeo. (3) Propriedades da entidade em `snake_case`, seguindo `RefreshToken`/`Channel`; o DTO de resposta mapeia para `camelCase`.

### API Contracts

Todos os endpoints exigem `Authorization: Bearer <access_token>` (guard global; nenhum `@Public()` nesta fase). Erros usam o envelope herdado `{ statusCode, error, message }` (per `phase-02-auth/TD-07`). Corpos JSON em `camelCase`. Handshake de upload per `phase-03-videos/TD-02` (S3 multipart, partes enviadas direto ao storage via URLs pré-assinadas); URL única per `phase-03-videos/TD-06`; entrega per `phase-03-videos/TD-07`.

**Decisões de build registradas:** (1) `:publicId` é o único identificador em rotas; o `id` uuid interno nunca vaza. (2) `POST /videos` cria o rascunho + sessão multipart (REST: cria o recurso). (3) Nesta fase a autorização de leitura é somente do dono (vídeo é sempre `draft`); acesso anônimo/visibilidade pública entra com o fluxo de publicação da Fase 04. (4) O host assinado das URLs pré-assinadas vem de `S3_PUBLIC_ENDPOINT`; como a fase é backend-only e todo teste roda dentro do Compose, o default em `.env.example` é `http://minio:9000` — ambientes com cliente em navegador sobrescrevem (ex.: `http://localhost:9000`).

#### POST /videos (SI-03.11)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer <access_token>

**Request body:**
- filename: string, required — 1 a 255 caracteres
- contentType: string, required — deve casar `^video\/[A-Za-z0-9.+-]+$`
- size: integer, required — mínimo 1 (bytes); máximo `VIDEO_MAX_SIZE_BYTES` (10 GiB) aplicado pelo serviço

**Response 201:**
- publicId: string — 11 caracteres `[A-Za-z0-9_-]`
- title: string
- processingStatus: string — `"uploading"`
- publicationStatus: string — `"draft"`
- upload: object
  - uploadId: string
  - partSize: integer — bytes por parte (última parte pode ser menor)
  - partCount: integer — `ceil(size / partSize)`

**Error responses:**
- 400 VALIDATION_ERROR: corpo inválido (campo ausente, `contentType` fora do padrão, `size` não inteiro/< 1, propriedade desconhecida)
- 401: token ausente ou inválido
- 404 CHANNEL_NOT_FOUND: usuário autenticado sem canal
- 413 VIDEO_TOO_LARGE: `size` maior que `VIDEO_MAX_SIZE_BYTES`

---

#### POST /videos/:publicId/upload/parts (SI-03.12)

Solicita URLs pré-assinadas `UploadPart` (`PUT`) para as partes informadas. O cliente envia os bytes da parte direto à URL e lê o header `ETag` da resposta do storage.

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer <access_token>

**Request body:**
- partNumbers: integer[], required — 1 a 100 itens, únicos, cada um entre 1 e `partCount`

**Response 200:**
- parts: array
  - partNumber: integer
  - url: string — URL pré-assinada `PUT` (validade `VIDEO_PART_URL_TTL_SECONDS`)

**Error responses:**
- 400 VALIDATION_ERROR: `partNumbers` ausente, vazio, com mais de 100 itens ou com itens não inteiros/< 1
- 400 INVALID_UPLOAD_PARTS: algum `partNumber` maior que `partCount` do vídeo
- 401: token ausente ou inválido
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro usuário
- 409 INVALID_UPLOAD_STATE: `processing_status` diferente de `uploading`

---

#### GET /videos/:publicId/upload (SI-03.13)

Retorna as partes já recebidas pelo storage (`ListParts`) para retomar um upload interrompido.

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- processingStatus: string — `"uploading"`
- partSize: integer
- partCount: integer
- parts: array — partes já enviadas
  - partNumber: integer
  - size: integer
  - etag: string

**Error responses:**
- 401: token ausente ou inválido
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro usuário
- 409 INVALID_UPLOAD_STATE: `processing_status` diferente de `uploading`

---

#### POST /videos/:publicId/upload/complete (SI-03.14)

Finaliza o multipart, verifica o objeto no storage, transiciona o vídeo para `processing` e enfileira o processamento. Idempotente: chamar novamente com o vídeo já em `processing`/`ready` devolve `202` com o status atual (e re-enfileira de forma segura, por `jobId = videoId`, apenas quando `processing`).

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer <access_token>

**Request body:**
- parts: array, required — exatamente `partCount` itens, `partNumber` de 1 a `partCount` sem lacunas
  - partNumber: integer, required
  - etag: string, required

**Response 202:**
- publicId: string
- processingStatus: string — `"processing"` | `"ready"`

**Error responses:**
- 400 VALIDATION_ERROR: corpo inválido
- 400 INVALID_UPLOAD_PARTS: quantidade ou numeração de partes não confere com o `partCount` do vídeo
- 401: token ausente ou inválido
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro usuário
- 409 INVALID_UPLOAD_STATE: vídeo em `failed`
- 422 UPLOAD_SIZE_MISMATCH: `ContentLength` do objeto difere de `size_bytes` (objeto removido, vídeo marcado `failed`)

---

#### GET /videos/:publicId (SI-03.16)

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- publicId: string
- title: string
- processingStatus: string — `"uploading"` | `"processing"` | `"ready"` | `"failed"`
- publicationStatus: string — `"draft"` | `"published"`
- failureReason: string | null
- sizeBytes: integer
- durationSeconds: number | null
- width: integer | null
- height: integer | null
- videoCodec: string | null
- formatName: string | null
- hasThumbnail: boolean
- createdAt: string (ISO 8601)

**Error responses:**
- 401: token ausente ou inválido
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro usuário

---

#### GET /videos/:publicId/stream (SI-03.17)

A API autoriza e redireciona; os bytes (incluindo `Range`/`206`) são servidos pelo storage (per `phase-03-videos/TD-07`).

**Request headers:**
- Authorization: Bearer <access_token>

**Response 302:**
- Location: URL pré-assinada `GET` do objeto original (validade `VIDEO_STREAM_URL_TTL_SECONDS`, default 3 horas)

**Error responses:**
- 401: token ausente ou inválido
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro usuário
- 409 VIDEO_NOT_READY: `processing_status` diferente de `ready`

---

#### GET /videos/:publicId/download (SI-03.18)

**Request headers:**
- Authorization: Bearer <access_token>

**Response 302:**
- Location: URL pré-assinada `GET` com `ResponseContentDisposition: attachment; filename*=UTF-8''<original_filename codificado>`

**Error responses:**
- 401: token ausente ou inválido
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro usuário
- 409 VIDEO_NOT_READY: `processing_status` diferente de `ready`

---

#### GET /videos/:publicId/thumbnail (SI-03.19)

**Request headers:**
- Authorization: Bearer <access_token>

**Response 302:**
- Location: URL pré-assinada `GET` de `thumbnail_key` (`image/jpeg`)

**Error responses:**
- 401: token ausente ou inválido
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro usuário
- 409 VIDEO_NOT_READY: vídeo sem `thumbnail_key` (ainda não processado)

---

#### Validation Rules — Upload

- `filename`: string não vazia, até 255 caracteres
- `contentType`: `^video\/[A-Za-z0-9.+-]+$`
- `size`: inteiro ≥ 1; limite superior `VIDEO_MAX_SIZE_BYTES` (default `10737418240`) validado no serviço (413, não 400)
- `partNumbers`: array de 1–100 inteiros únicos ≥ 1
- `parts[].partNumber`: inteiro ≥ 1; `parts[].etag`: string não vazia
- `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`) herdado — propriedades desconhecidas retornam 400

### Authorization Matrix

"Owner" = usuário autenticado cujo `channel.user_id` é o dono do vídeo. Não-dono recebe `404 VIDEO_NOT_FOUND` (não revela a existência do vídeo). Anônimo recebe `401` do guard global.

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| POST /videos | ✗ | ✓ (cria no próprio canal) | ✓ |
| POST /videos/:publicId/upload/parts | ✗ | ✗ | ✓ |
| GET /videos/:publicId/upload | ✗ | ✗ | ✓ |
| POST /videos/:publicId/upload/complete | ✗ | ✗ | ✓ |
| GET /videos/:publicId | ✗ | ✗ | ✓ |
| GET /videos/:publicId/stream | ✗ | ✗ | ✓ |
| GET /videos/:publicId/download | ✗ | ✗ | ✓ |
| GET /videos/:publicId/thumbnail | ✗ | ✗ | ✓ |

### Error Catalog

Formato herdado `{ statusCode, error, message }` (per `phase-02-auth/TD-07`); `error` carrega o `errorCode`. Códigos novos são subclasses de `DomainException`.

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VIDEO_NOT_FOUND | 404 | `publicId` inexistente, ou vídeo pertence a outro usuário |
| CHANNEL_NOT_FOUND | 404 | `POST /videos` por usuário sem canal |
| VIDEO_TOO_LARGE | 413 | `size` acima de `VIDEO_MAX_SIZE_BYTES` (10 GiB) |
| INVALID_UPLOAD_STATE | 409 | Operação de upload (partes, listagem, complete) fora do estado permitido (`uploading`; `complete` rejeita `failed`) |
| INVALID_UPLOAD_PARTS | 400 | `partNumber` > `partCount`, ou lista do `complete` com quantidade/numeração divergente |
| UPLOAD_SIZE_MISMATCH | 422 | `HeadObject` após `complete` com `ContentLength` ≠ `size_bytes` |
| VIDEO_NOT_READY | 409 | Stream, download ou thumbnail antes de `processing_status = 'ready'` |
| VALIDATION_ERROR | 400 | _(herdado)_ falha de `class-validator` |

### Events/Messages

#### video.process

Job BullMQ `process-video` na fila `video-processing` (Redis, host `redis`).

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** `VideoProcessingProducer` (per `phase-03-videos/TD-01`) — chamado por `VideoUploadsService.complete` após a transição `uploading → processing`
**Consumer:** `VideoProcessingProcessor` (`@Processor` + `WorkerHost`) no `WorkerModule`, executado pelo serviço `video-worker` do Compose (per `phase-03-videos/TD-01`, `TD-04`)
**Trigger:** `POST /videos/:publicId/upload/complete` bem-sucedido
**Delivery semantics:** at-least-once, tornado idempotente por `jobId = videoId` (BullMQ não duplica job com `jobId` existente) e por transições condicionais de `processing_status`; `attempts` e `backoff` exponencial vindos de `VIDEO_PROCESSING_ATTEMPTS` / `VIDEO_PROCESSING_BACKOFF_MS` (defaults 3 / 5000 ms); `UnrecoverableError` (arquivo sem stream de vídeo, mídia inválida, vídeo inexistente) vai direto para `failed` sem retentativas; ao esgotar tentativas o handler `@OnWorkerEvent('failed')` marca `processing_status = 'failed'` com `failure_reason` (per `phase-03-videos/TD-08`)

**Pipeline do worker (per `phase-03-videos/TD-05`):** gera URL `GET` pré-assinada do objeto original → `ffprobe -print_format json -show_format -show_streams` sobre a URL (sem baixar o arquivo) → valida a existência de stream de vídeo → `ffmpeg -ss <t> -i <url> -frames:v 1` produz o JPEG da thumbnail (`t = min(1s, duração/2)`) → `PutObject` em `videos/{id}/thumbnail.jpg` → grava duração, dimensões, codec, formato e `thumbnail_key` e marca `ready`.

**Decisões de build registradas:** (1) o prefixo da fila é configurável (`QUEUE_PREFIX`, default `streamtube`) para que testes de integração com Redis real usem um prefixo único e não sejam consumidos pelo worker do Compose; os e2e usam o prefixo default e dependem do worker real. (2) `removeOnComplete: true`; jobs falhos são mantidos para inspeção.

---

## Dependency Map

```
SI-03.1 (root — infra Compose)
├── SI-03.3 (também depende de SI-03.2)
├── SI-03.7 (também depende de SI-03.2)
└── SI-03.20 (também depende de SI-03.3)
SI-03.2 (root — dependências e config)
├── SI-03.3
└── SI-03.7
SI-03.4 (root — entidade Video + migration)
SI-03.5 (root, independente — id público)
SI-03.6 (root, independente — exceções + canal por usuário)

SI-03.4 + SI-03.6
└── SI-03.8 — VideosService
    ├── SI-03.9 (também depende de SI-03.3, SI-03.4, SI-03.5, SI-03.6)
    │   ├── SI-03.10 (também depende de SI-03.7)
    │   │   ├── SI-03.12 (também depende de SI-03.11)
    │   │   ├── SI-03.13 (também depende de SI-03.11)
    │   │   └── SI-03.14 (também depende de SI-03.11)
    │   └── SI-03.11
    ├── SI-03.15 (também depende de SI-03.3)
    │   ├── SI-03.17 (também depende de SI-03.16)
    │   ├── SI-03.18 (também depende de SI-03.16)
    │   └── SI-03.19 (também depende de SI-03.16)
    ├── SI-03.16 (também depende de SI-03.11)
    └── SI-03.21 (também depende de SI-03.20)
        └── SI-03.22 (também depende de SI-03.1, SI-03.7)
            └── SI-03.23 (também depende de SI-03.14, SI-03.17, SI-03.18, SI-03.19)

SI-03.14 + SI-03.16 + SI-03.17 + SI-03.18 + SI-03.19
└── SI-03.24 — contrato OpenAPI e api.http
```

Ordem linearizada: SI-03.1, SI-03.2, SI-03.4, SI-03.5, SI-03.6 (raízes, em paralelo) → SI-03.3, SI-03.7, SI-03.8 → SI-03.9, SI-03.20, SI-03.15 → SI-03.10, SI-03.11, SI-03.21 → SI-03.12, SI-03.13, SI-03.14, SI-03.16, SI-03.22 → SI-03.17, SI-03.18, SI-03.19 → SI-03.23, SI-03.24

---

## Deliverables

- [x] SI-03.1 — Infra: MinIO, Redis, worker e FFmpeg no Docker Compose
- [x] SI-03.2 — Dependências e namespaces de configuração (storage, fila, vídeo)
- [x] SI-03.3 — StorageModule: cliente S3/MinIO e operações de objeto
- [x] SI-03.4 — Entidade Video, migration e VideosModule base
- [x] SI-03.5 — Gerador de id público do vídeo
- [x] SI-03.6 — Exceções de domínio de vídeo e busca de canal por usuário
- [x] SI-03.7 — QueueModule e producer da fila de processamento
- [x] SI-03.8 — VideosService: posse, transições de status e DTO de resposta
- [x] SI-03.9 — Início do upload: pré-cadastro do rascunho e sessão multipart
- [x] SI-03.10 — Handshake de upload: URLs de partes, retomada e conclusão
- [x] SI-03.11 — Endpoint POST /videos
- [x] SI-03.12 — Endpoint POST /videos/:publicId/upload/parts
- [x] SI-03.13 — Endpoint GET /videos/:publicId/upload
- [x] SI-03.14 — Endpoint POST /videos/:publicId/upload/complete
- [x] SI-03.15 — VideoDeliveryService: URLs de streaming, download e thumbnail
- [x] SI-03.16 — Endpoint GET /videos/:publicId
- [x] SI-03.17 — Endpoint GET /videos/:publicId/stream
- [x] SI-03.18 — Endpoint GET /videos/:publicId/download
- [x] SI-03.19 — Endpoint GET /videos/:publicId/thumbnail
- [x] SI-03.20 — MediaModule: ffprobe e ffmpeg sobre URL pré-assinada
- [x] SI-03.21 — VideoProcessingService: metadados e thumbnail
- [x] SI-03.22 — Worker de vídeo: processor BullMQ, retry/falha e entrypoint separado
- [x] SI-03.23 — E2E ponta a ponta com a infraestrutura real do Compose
- [x] SI-03.24 — Contrato OpenAPI e coleção de requests de vídeos

**Full test suites** _(requerem `docker compose up -d` com `db`, `minio`, `minio-init`, `redis`, `mailpit` e `video-worker` saudáveis)_:

- [x] Backend tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [x] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [x] Type/compilation checks pass (`docker compose exec nestjs-api npx tsc --noEmit`)
- [x] Lint passes (`docker compose exec nestjs-api npm run lint`)
- [x] Project builds successfully (`docker compose exec nestjs-api npm run build`) — gera `dist/main` e `dist/worker`
