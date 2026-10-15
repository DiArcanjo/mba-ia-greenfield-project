---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.16
target_file: test/videos-get.e2e-spec.ts
---

# GET /videos/:publicId Test Plan

## Application Overview

Devolve dados e status de processamento do vídeo ao dono, até ready/failed.

## Test Scenarios

### 1. GET /videos/:publicId

**Setup:** `beforeEach` limpa as tabelas (`cleanAllTables`); `AppModule` completo com ValidationPipe, DomainExceptionFilter e ValidationExceptionFilter de `main.ts`; MinIO, Redis e worker reais do Compose; usuários A (dono) e B (outro) autenticados via helpers de `src/test/video-flow.ts`.

#### 1.1. returns-draft-after-initiate

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. A cria vídeo via POST /videos; GET /videos/:publicId
    - expect: status 200; processingStatus "uploading"; publicationStatus "draft"; hasThumbnail false; durationSeconds null; corpo sem chave id

#### 1.2. returns-metadata-when-ready

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. A completa upload de MP4 válido; waitForProcessing até ready (60 s); GET /videos/:publicId
    - expect: processingStatus "ready"; durationSeconds numérico; width, height, videoCodec e formatName presentes; hasThumbnail true

#### 1.3. unknown-public-id

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. GET /videos/<publicId inexistente> como A
    - expect: status 404; error "VIDEO_NOT_FOUND"

#### 1.4. hides-video-from-other-user

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. GET /videos/:publicId como B
    - expect: status 404; error "VIDEO_NOT_FOUND"

#### 1.5. requires-authentication

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. GET /videos/:publicId sem Authorization
    - expect: status 401
