---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.14
target_file: test/videos-upload-complete.e2e-spec.ts
---

# POST /videos/:publicId/upload/complete Test Plan

## Application Overview

Finaliza o multipart, verifica o objeto e dispara o processamento em segundo plano (202).

## Test Scenarios

### 1. POST /videos/:publicId/upload/complete

**Setup:** `beforeEach` limpa as tabelas (`cleanAllTables`); `AppModule` completo com ValidationPipe, DomainExceptionFilter e ValidationExceptionFilter de `main.ts`; MinIO, Redis e worker reais do Compose; usuários A (dono) e B (outro) autenticados via helpers de `src/test/video-flow.ts`.

#### 1.1. completes-and-enqueues

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. A cria vídeo, envia todas as partes ao MinIO coletando etags; POST .../upload/complete com parts e etags
    - expect: status 202; processingStatus "processing" (ou já avançado pelo worker)

#### 1.2. complete-is-idempotent

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. Repetir POST .../upload/complete para o mesmo vídeo
    - expect: status 202 sem erro

#### 1.3. rejects-missing-parts

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. Enviar menos partes que partCount; POST .../upload/complete
    - expect: status 400; error "INVALID_UPLOAD_PARTS"

#### 1.4. rejects-parts-without-etag

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. POST .../upload/complete com parts sem etag
    - expect: status 400; error "VALIDATION_ERROR"

#### 1.5. rejects-size-mismatch

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. Declarar size X no POST /videos e enviar objeto de tamanho diferente; POST .../upload/complete
    - expect: status 422; error "UPLOAD_SIZE_MISMATCH"

#### 1.6. hides-video-from-other-user

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. POST .../upload/complete como B
    - expect: status 404; error "VIDEO_NOT_FOUND"

#### 1.7. requires-authentication

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. POST .../upload/complete sem Authorization
    - expect: status 401
