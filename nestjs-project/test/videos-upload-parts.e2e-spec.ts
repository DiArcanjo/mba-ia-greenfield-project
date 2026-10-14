import request from 'supertest';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import {
  deleteKeysByPrefix,
  uploadPartViaPresignedUrl,
} from '../src/test/storage';
import {
  authHeader,
  createVideoTestApp,
  initiateUpload,
  registerAndLogin,
  resetThrottler,
  type TestApp,
  type TestUser,
} from '../src/test/video-flow';

const MIB = 1024 * 1024;

describe('POST /videos/:publicId/upload/parts (e2e)', () => {
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

  const postParts = (
    user: TestUser | null,
    publicId: string,
    body: unknown,
  ) => {
    const req = request(app.getHttpServer()).post(
      `/videos/${publicId}/upload/parts`,
    );
    return (user ? req.set(authHeader(user)) : req).send(body as object);
  };

  // 128 MiB with the default 64 MiB part size => 2 parts
  const twoPartVideo = {
    filename: 'long.mp4',
    contentType: 'video/mp4',
    size: 128 * MIB,
  };

  it('presigns-parts-and-minio-accepts-put', async () => {
    const session = await initiateUpload(app, userA, twoPartVideo);

    const res = await postParts(userA, session.publicId, {
      partNumbers: [1, 2],
    }).expect(200);

    const { parts } = res.body as {
      parts: { partNumber: number; url: string }[];
    };
    expect(parts.map((p) => p.partNumber)).toEqual([1, 2]);
    for (const part of parts) {
      expect(typeof part.url).toBe('string');
      const etag = await uploadPartViaPresignedUrl(
        part.url,
        new Uint8Array(16),
      );
      expect(etag).toBeTruthy();
    }
  });

  it('rejects-part-above-part-count', async () => {
    const session = await initiateUpload(app, userA, twoPartVideo);

    const res = await postParts(userA, session.publicId, {
      partNumbers: [1, 3],
    }).expect(400);

    expect((res.body as { error: string }).error).toBe('INVALID_UPLOAD_PARTS');
  });

  it('rejects-empty-part-numbers', async () => {
    const session = await initiateUpload(app, userA, twoPartVideo);

    const res = await postParts(userA, session.publicId, {
      partNumbers: [],
    }).expect(400);

    expect((res.body as { error: string }).error).toBe('VALIDATION_ERROR');
  });

  it('hides-video-from-other-user', async () => {
    const session = await initiateUpload(app, userA, twoPartVideo);

    const res = await postParts(userB, session.publicId, {
      partNumbers: [1],
    }).expect(404);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });

  it('rejects-video-in-processing', async () => {
    const session = await initiateUpload(app, userA);
    // Driven through the DB: the complete endpoint arrives in a later SI.
    await dataSource.query(
      `UPDATE "videos" SET "processing_status" = 'processing' WHERE "public_id" = $1`,
      [session.publicId],
    );

    const res = await postParts(userA, session.publicId, {
      partNumbers: [1],
    }).expect(409);

    expect((res.body as { error: string }).error).toBe('INVALID_UPLOAD_STATE');
  });

  it('requires-authentication', async () => {
    await postParts(null, 'abcdefghijk', { partNumbers: [1] }).expect(401);
  });
});
