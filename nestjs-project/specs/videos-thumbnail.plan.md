---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.19
target_file: test/videos-thumbnail.e2e-spec.ts
---

# GET /videos/:publicId/thumbnail Test Plan

## Application Overview

Autoriza o dono e redireciona (302) para URL pré-assinada da thumbnail gerada pelo worker.

## Test Scenarios

### 1. GET /videos/:publicId/thumbnail

**Setup:** `beforeEach` limpa as tabelas (`cleanAllTables`); `AppModule` completo com ValidationPipe, DomainExceptionFilter e ValidationExceptionFilter de `main.ts`; MinIO, Redis e worker reais do Compose; usuários A (dono) e B (outro) autenticados via helpers de `src/test/video-flow.ts`.

#### 1.1. redirects-to-jpeg

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. Com vídeo ready de A, GET .../thumbnail sem seguir redirect; GET na URL de Location
    - expect: status 302; Location responde 200 com Content-Type image/jpeg

#### 1.2. rejects-video-without-thumbnail

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. Vídeo ainda não processado; GET .../thumbnail como A
    - expect: status 409; error "VIDEO_NOT_READY"

#### 1.3. hides-video-from-other-user

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. GET .../thumbnail como B
    - expect: status 404; error "VIDEO_NOT_FOUND"

#### 1.4. requires-authentication

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. GET .../thumbnail sem Authorization
    - expect: status 401
