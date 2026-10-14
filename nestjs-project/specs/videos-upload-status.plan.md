---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.13
target_file: test/videos-upload-status.e2e-spec.ts
---

# GET /videos/:publicId/upload Test Plan

## Application Overview

Lista as partes já recebidas pelo storage para retomada de upload interrompido; apenas o dono.

## Test Scenarios

### 1. GET /videos/:publicId/upload

**Setup:** `beforeEach` limpa as tabelas (`cleanAllTables`); `AppModule` completo com ValidationPipe, DomainExceptionFilter e ValidationExceptionFilter de `main.ts`; MinIO, Redis e worker reais do Compose; usuários A (dono) e B (outro) autenticados via helpers de `src/test/video-flow.ts`.

#### 1.1. empty-parts-after-initiate

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. A cria vídeo; GET /videos/:publicId/upload
    - expect: status 200; parts []; partSize e partCount presentes

#### 1.2. lists-uploaded-part

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. A obtém URL da parte 1 e faz PUT de bytes no MinIO; GET /videos/:publicId/upload
    - expect: status 200; parts contém partNumber 1 com size e etag da parte

#### 1.3. rejects-video-in-processing

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. Levar vídeo a processing; GET .../upload como A
    - expect: status 409; error "INVALID_UPLOAD_STATE"

#### 1.4. hides-video-from-other-user

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. GET .../upload como B
    - expect: status 404; error "VIDEO_NOT_FOUND"

#### 1.5. requires-authentication

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. GET .../upload sem Authorization
    - expect: status 401
