import request from 'supertest';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import {
  deleteKeysByPrefix,
  uploadPartViaPresignedUrl,
} from '../src/test/storage';
import {
  authHeader,
  completeUpload,
  createVideoTestApp,
  initiateUpload,
  registerAndLogin,
  resetThrottler,
  uploadAllParts,
  type TestApp,
  type TestUser,
} from '../src/test/video-flow';

const MIB = 1024 * 1024;

describe('Video upload handshake (e2e)', () => {
  let app: TestApp;
  let dataSource: DataSource;
  let userA: TestUser;
  let userB: TestUser;

  beforeAll(async () => {
    app = await createVideoTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await cleanAllTables(dataSource);
    await deleteKeysByPrefix('videos/');
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    resetThrottler(app);
    userA = await registerAndLogin(app, 'owner-a@example.com');
    userB = await registerAndLogin(app, 'owner-b@example.com');
  });

  const errorOf = (res: request.Response) =>
    (res.body as { error: string }).error;

  describe('POST /videos', () => {
    it('validates the DTO and the size limit', async () => {
      const valid = { filename: 'a.mp4', contentType: 'video/mp4', size: 10 };
      const post = (body: object) =>
        request(app.getHttpServer())
          .post('/videos')
          .set(authHeader(userA))
          .send(body);

      expect(errorOf(await post({ ...valid, filename: '' }).expect(400))).toBe(
        'VALIDATION_ERROR',
      );
      expect(
        errorOf(await post({ ...valid, contentType: 'image/png' }).expect(400)),
      ).toBe('VALIDATION_ERROR');
      expect(errorOf(await post({ ...valid, size: 0 }).expect(400))).toBe(
        'VALIDATION_ERROR',
      );
      expect(errorOf(await post({ ...valid, size: 1.5 }).expect(400))).toBe(
        'VALIDATION_ERROR',
      );
      expect(
        errorOf(await post({ ...valid, size: 10737418241 }).expect(413)),
      ).toBe('VIDEO_TOO_LARGE');
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/videos')
        .send({ filename: 'a.mp4', contentType: 'video/mp4', size: 10 })
        .expect(401);
    });

    it('gives two consecutive videos distinct publicIds', async () => {
      const first = await initiateUpload(app, userA);
      const second = await initiateUpload(app, userA);

      expect(first.publicId).not.toBe(second.publicId);
    });
  });

  describe('ownership', () => {
    it('answers 404 VIDEO_NOT_FOUND to another user on every upload route', async () => {
      const session = await initiateUpload(app, userA);
      const base = `/videos/${session.publicId}`;

      const parts = await request(app.getHttpServer())
        .post(`${base}/upload/parts`)
        .set(authHeader(userB))
        .send({ partNumbers: [1] })
        .expect(404);
      const status = await request(app.getHttpServer())
        .get(`${base}/upload`)
        .set(authHeader(userB))
        .expect(404);
      const complete = await completeUpload(app, userB, session.publicId, [
        { partNumber: 1, etag: '"x"' },
      ]).expect(404);

      for (const res of [parts, status, complete]) {
        expect(errorOf(res)).toBe('VIDEO_NOT_FOUND');
      }
    });

    it('answers 401 without a token on every upload route', async () => {
      const base = '/videos/abcdefghijk';

      await request(app.getHttpServer())
        .post(`${base}/upload/parts`)
        .send({ partNumbers: [1] })
        .expect(401);
      await request(app.getHttpServer()).get(`${base}/upload`).expect(401);
      await request(app.getHttpServer())
        .post(`${base}/upload/complete`)
        .send({ parts: [] })
        .expect(401);
    });
  });

  describe('resume', () => {
    it('lists the parts already stored in MinIO after an interrupted upload', async () => {
      // 128 MiB with 64 MiB parts => 2 parts; only part 2 gets uploaded
      const session = await initiateUpload(app, userA, {
        filename: 'long.mp4',
        contentType: 'video/mp4',
        size: 128 * MIB,
      });
      const presigned = await request(app.getHttpServer())
        .post(`/videos/${session.publicId}/upload/parts`)
        .set(authHeader(userA))
        .send({ partNumbers: [2] })
        .expect(200);
      const { url } = (
        presigned.body as { parts: { partNumber: number; url: string }[] }
      ).parts[0];
      const etag = await uploadPartViaPresignedUrl(url, new Uint8Array(2048));

      const res = await request(app.getHttpServer())
        .get(`/videos/${session.publicId}/upload`)
        .set(authHeader(userA))
        .expect(200);

      expect(res.body).toMatchObject({
        processingStatus: 'uploading',
        partCount: 2,
        parts: [{ partNumber: 2, size: 2048, etag }],
      });
    });
  });

  describe('complete', () => {
    it('is idempotent', async () => {
      const content = new Uint8Array(2048);
      const session = await initiateUpload(app, userA, {
        filename: 'a.mp4',
        contentType: 'video/mp4',
        size: content.length,
      });
      const parts = await uploadAllParts(app, userA, session, content);

      const first = await completeUpload(
        app,
        userA,
        session.publicId,
        parts,
      ).expect(202);
      const second = await completeUpload(
        app,
        userA,
        session.publicId,
        parts,
      ).expect(202);

      expect((first.body as { publicId: string }).publicId).toBe(
        session.publicId,
      );
      expect((second.body as { publicId: string }).publicId).toBe(
        session.publicId,
      );
    });

    it('answers 422 UPLOAD_SIZE_MISMATCH when the object differs from the declared size', async () => {
      const content = new Uint8Array(1024);
      const session = await initiateUpload(app, userA, {
        filename: 'a.mp4',
        contentType: 'video/mp4',
        size: 4096,
      });
      const parts = await uploadAllParts(app, userA, session, content);

      const res = await completeUpload(
        app,
        userA,
        session.publicId,
        parts,
      ).expect(422);

      expect(errorOf(res)).toBe('UPLOAD_SIZE_MISMATCH');
    });
  });
});
