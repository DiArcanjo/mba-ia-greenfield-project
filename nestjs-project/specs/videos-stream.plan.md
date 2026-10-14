---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.17
target_file: test/videos-stream.e2e-spec.ts
---

# GET /videos/:publicId/stream Test Plan

## Application Overview

Autoriza o dono e redireciona (302) para URL pré-assinada do MinIO, que serve Range/206.

## Test Scenarios

### 1. GET /videos/:publicId/stream

**Setup:** `beforeEach` limpa as tabelas (`cleanAllTables`); `AppModule` completo com ValidationPipe, DomainExceptionFilter e ValidationExceptionFilter de `main.ts`; MinIO, Redis e worker reais do Compose; usuários A (dono) e B (outro) autenticados via helpers de `src/test/video-flow.ts`.

#### 1.1. redirects-to-minio

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. Com vídeo ready de A, GET .../stream sem seguir redirect
    - expect: status 302; header Location aponta para o MinIO

#### 1.2. range-request-returns-206

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. GET na URL de Location com Range: bytes=0-1023
    - expect: status 206; header Content-Range presente; corpo com 1024 bytes

#### 1.3. rejects-video-not-ready

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. Vídeo ainda não ready; GET .../stream como A
    - expect: status 409; error "VIDEO_NOT_READY"

#### 1.4. hides-video-from-other-user

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. GET .../stream como B
    - expect: status 404; error "VIDEO_NOT_FOUND"

#### 1.5. requires-authentication

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. GET .../stream sem Authorization
    - expect: status 401
