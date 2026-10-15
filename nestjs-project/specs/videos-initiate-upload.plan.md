---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.11
target_file: test/videos-initiate-upload.e2e-spec.ts
---

# POST /videos Test Plan

## Application Overview

Inicia o upload: cria o rascunho do vídeo e devolve a sessão multipart (uploadId, partSize, partCount). Exige autenticação.

## Test Scenarios

### 1. POST /videos

**Setup:** `beforeEach` limpa as tabelas (`cleanAllTables`); `AppModule` completo com ValidationPipe, DomainExceptionFilter e ValidationExceptionFilter de `main.ts`; MinIO, Redis e worker reais do Compose; usuários A (dono) e B (outro) autenticados via helpers de `src/test/video-flow.ts`.

#### 1.1. creates-draft-and-session

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. POST /videos como A com {filename:"aula.mp4",contentType:"video/mp4",size:12582912}
    - expect: status 201; publicId com 11 caracteres; processingStatus "uploading"; publicationStatus "draft"; title "aula"; upload.uploadId, upload.partSize e upload.partCount presentes

#### 1.2. rejects-too-large

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. POST /videos como A com size 10737418241
    - expect: status 413; error "VIDEO_TOO_LARGE"

#### 1.3. rejects-invalid-content-type

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. POST /videos como A com contentType "image/png"
    - expect: status 400; error "VALIDATION_ERROR"

#### 1.4. rejects-unknown-property

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. POST /videos como A com corpo válido mais propriedade desconhecida
    - expect: status 400; error "VALIDATION_ERROR"

#### 1.5. requires-authentication

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-14T23:19:35Z

**Steps:**
  1. POST /videos sem Authorization
    - expect: status 401
