---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.12
target_file: test/videos-upload-parts.e2e-spec.ts
---

# POST /videos/:publicId/upload/parts Test Plan

## Application Overview

Emite URLs pré-assinadas para partes do upload multipart; apenas o dono, enquanto o vídeo está em uploading.

## Test Scenarios

### 1. POST /videos/:publicId/upload/parts

**Setup:** `beforeEach` limpa as tabelas (`cleanAllTables`); `AppModule` completo com ValidationPipe, DomainExceptionFilter e ValidationExceptionFilter de `main.ts`; MinIO, Redis e worker reais do Compose; usuários A (dono) e B (outro) autenticados via helpers de `src/test/video-flow.ts`.

#### 1.1. presigns-parts-and-minio-accepts-put

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. A cria vídeo via POST /videos; POST /videos/:publicId/upload/parts com {partNumbers:[1,2]}
    - expect: status 200; parts com partNumber e url para 1 e 2
  2. PUT de bytes em cada url
    - expect: MinIO aceita e devolve header ETag

#### 1.2. rejects-part-above-part-count

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. POST .../upload/parts com partNumbers contendo número > partCount
    - expect: status 400; error "INVALID_UPLOAD_PARTS"

#### 1.3. rejects-empty-part-numbers

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. POST .../upload/parts com partNumbers []
    - expect: status 400; error "VALIDATION_ERROR"

#### 1.4. hides-video-from-other-user

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. POST .../upload/parts como B
    - expect: status 404; error "VIDEO_NOT_FOUND"

#### 1.5. rejects-video-in-processing

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. Levar vídeo a processing (upload completo); POST .../upload/parts como A
    - expect: status 409; error "INVALID_UPLOAD_STATE"

#### 1.6. requires-authentication

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. POST .../upload/parts sem Authorization
    - expect: status 401
