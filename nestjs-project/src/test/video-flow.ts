import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../app.module';
import { AuthService } from '../auth/auth.service';
import { DomainExceptionFilter } from '../common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../common/filters/validation-exception.filter';
import type { MailService } from '../mail/mail.service';
import { uploadPartViaPresignedUrl } from './storage';

export type TestApp = INestApplication<App>;

export interface TestUser {
  email: string;
  accessToken: string;
}

export interface UploadSession {
  publicId: string;
  upload: { uploadId: string; partSize: number; partCount: number };
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

/** Boots the full AppModule with the same global config as main.ts. */
export async function createVideoTestApp(): Promise<TestApp> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication<TestApp>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.init();
  return app;
}

export function resetThrottler(app: TestApp): void {
  app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
}

/** Registers, confirms the email and logs in a user, returning its access token. */
export async function registerAndLogin(
  app: TestApp,
  email: string,
  password = 'password123',
): Promise<TestUser> {
  const authService = app.get(AuthService);
  const mailService = (authService as unknown as { mailService: MailService })
    .mailService;
  let token = '';
  const spy = jest
    .spyOn(mailService, 'sendConfirmationEmail')
    .mockImplementationOnce((_e: string, _n: string, t: string) => {
      token = t;
      return Promise.resolve();
    });
  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  spy.mockRestore();
  await request(app.getHttpServer())
    .get('/auth/confirm-email')
    .query({ token })
    .expect(204);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);
  return {
    email,
    accessToken: (login.body as { access_token: string }).access_token,
  };
}

export function authHeader(user: TestUser): { Authorization: string } {
  return { Authorization: `Bearer ${user.accessToken}` };
}

export async function initiateUpload(
  app: TestApp,
  user: TestUser,
  body: { filename: string; contentType: string; size: number } = {
    filename: 'aula.mp4',
    contentType: 'video/mp4',
    size: 1024,
  },
): Promise<UploadSession> {
  const res = await request(app.getHttpServer())
    .post('/videos')
    .set(authHeader(user))
    .send(body)
    .expect(201);
  return res.body as UploadSession;
}

/** Requests presigned URLs for every part and PUTs the slices of `content`. */
export async function uploadAllParts(
  app: TestApp,
  user: TestUser,
  session: UploadSession,
  content: Uint8Array,
): Promise<CompletedPart[]> {
  const { partSize, partCount } = session.upload;
  const partNumbers = Array.from({ length: partCount }, (_, i) => i + 1);
  const res = await request(app.getHttpServer())
    .post(`/videos/${session.publicId}/upload/parts`)
    .set(authHeader(user))
    .send({ partNumbers })
    .expect(200);
  const { parts } = res.body as {
    parts: { partNumber: number; url: string }[];
  };
  const completed: CompletedPart[] = [];
  for (const { partNumber, url } of parts) {
    const slice = content.subarray(
      (partNumber - 1) * partSize,
      partNumber * partSize,
    );
    completed.push({
      partNumber,
      etag: await uploadPartViaPresignedUrl(url, slice),
    });
  }
  return completed;
}

export async function completeUpload(
  app: TestApp,
  user: TestUser,
  publicId: string,
  parts: CompletedPart[],
): Promise<request.Response> {
  return request(app.getHttpServer())
    .post(`/videos/${publicId}/upload/complete`)
    .set(authHeader(user))
    .send({ parts });
}

/** Polls GET /videos/:publicId until the video is ready or failed. */
export async function waitForProcessing(
  app: TestApp,
  user: TestUser,
  publicId: string,
  timeoutMs = 60_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(app.getHttpServer())
      .get(`/videos/${publicId}`)
      .set(authHeader(user))
      .expect(200);
    const body = res.body as Record<string, unknown>;
    if (
      body.processingStatus === 'ready' ||
      body.processingStatus === 'failed'
    ) {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Video ${publicId} did not finish processing in ${timeoutMs}ms`,
  );
}
