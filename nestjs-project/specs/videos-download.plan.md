---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.18
target_file: test/videos-download.e2e-spec.ts
---

# GET /videos/:publicId/download Test Plan

## Application Overview

Autoriza o dono e redireciona (302) para URL do storage que força Content-Disposition: attachment.

## Test Scenarios

### 1. GET /videos/:publicId/download

**Setup:** `beforeEach` limpa as tabelas (`cleanAllTables`); `AppModule` completo com ValidationPipe, DomainExceptionFilter e ValidationExceptionFilter de `main.ts`; MinIO, Redis e worker reais do Compose; usuários A (dono) e B (outro) autenticados via helpers de `src/test/video-flow.ts`.

#### 1.1. redirects-to-minio

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. Com vídeo ready de A, GET .../download sem seguir redirect
    - expect: status 302; header Location aponta para o MinIO

#### 1.2. download-forces-attachment

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. GET na URL de Location
    - expect: Content-Disposition com attachment e o original_filename; corpo baixado com size_bytes bytes

#### 1.3. rejects-video-not-ready

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. Vídeo ainda não ready; GET .../download como A
    - expect: status 409; error "VIDEO_NOT_READY"

#### 1.4. hides-video-from-other-user

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. GET .../download como B
    - expect: status 404; error "VIDEO_NOT_FOUND"

#### 1.5. requires-authentication

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. GET .../download sem Authorization
    - expect: status 401
