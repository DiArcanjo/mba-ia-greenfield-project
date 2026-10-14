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

describe('GET /videos/:publicId/upload (e2e)', () => {
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

  const getStatus = (user: TestUser | null, publicId: string) => {
    const req = request(app.getHttpServer()).get(`/videos/${publicId}/upload`);
    return user ? req.set(authHeader(user)) : req;
  };

  it('empty-parts-after-initiate', async () => {
    const session = await initiateUpload(app, userA);

    const res = await getStatus(userA, session.publicId).expect(200);

    const body = res.body as {
      parts: unknown[];
      partSize: number;
      partCount: number;
    };
    expect(body.parts).toEqual([]);
    expect(body.partSize).toEqual(expect.any(Number));
    expect(body.partCount).toBe(session.upload.partCount);
  });

  it('lists-uploaded-part', async () => {
    const session = await initiateUpload(app, userA, {
      filename: 'long.mp4',
      contentType: 'video/mp4',
      size: 128 * MIB,
    });
    const presigned = await request(app.getHttpServer())
      .post(`/videos/${session.publicId}/upload/parts`)
      .set(authHeader(userA))
      .send({ partNumbers: [1] })
      .expect(200);
    const { url } = (
      presigned.body as { parts: { partNumber: number; url: string }[] }
    ).parts[0];
    const etag = await uploadPartViaPresignedUrl(url, new Uint8Array(1024));

    const res = await getStatus(userA, session.publicId).expect(200);

    expect((res.body as { parts: unknown[] }).parts).toEqual([
      { partNumber: 1, size: 1024, etag },
    ]);
  });

  it('rejects-video-in-processing', async () => {
    const session = await initiateUpload(app, userA);
    // Driven through the DB: the complete endpoint arrives in a later SI.
    await dataSource.query(
      `UPDATE "videos" SET "processing_status" = 'processing' WHERE "public_id" = $1`,
      [session.publicId],
    );

    const res = await getStatus(userA, session.publicId).expect(409);

    expect((res.body as { error: string }).error).toBe('INVALID_UPLOAD_STATE');
  });

  it('hides-video-from-other-user', async () => {
    const session = await initiateUpload(app, userA);

    const res = await getStatus(userB, session.publicId).expect(404);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });

  it('requires-authentication', async () => {
    await getStatus(null, 'abcdefghijk').expect(401);
  });
});
