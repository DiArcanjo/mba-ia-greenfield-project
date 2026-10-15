import request from 'supertest';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { deleteKeysByPrefix } from '../src/test/storage';
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

describe('POST /videos/:publicId/upload/complete (e2e)', () => {
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

  async function startAndUpload(
    content: Uint8Array,
    declaredSize = content.length,
  ) {
    const session = await initiateUpload(app, userA, {
      filename: 'aula.mp4',
      contentType: 'video/mp4',
      size: declaredSize,
    });
    const parts = await uploadAllParts(app, userA, session, content);
    return { session, parts };
  }

  it('completes-and-enqueues', async () => {
    const { session, parts } = await startAndUpload(new Uint8Array(1024));

    const res = await completeUpload(
      app,
      userA,
      session.publicId,
      parts,
    ).expect(202);

    const body = res.body as { publicId: string; processingStatus: string };
    expect(body.publicId).toBe(session.publicId);
    expect(['processing', 'ready', 'failed']).toContain(body.processingStatus);
  });

  it('complete-is-idempotent', async () => {
    const { session, parts } = await startAndUpload(new Uint8Array(1024));
    await completeUpload(app, userA, session.publicId, parts).expect(202);

    await completeUpload(app, userA, session.publicId, parts).expect(202);
  });

  it('rejects-missing-parts', async () => {
    // 128 MiB with the default 64 MiB part size => 2 parts expected
    const session = await initiateUpload(app, userA, {
      filename: 'long.mp4',
      contentType: 'video/mp4',
      size: 128 * MIB,
    });

    const res = await completeUpload(app, userA, session.publicId, [
      { partNumber: 1, etag: '"abc"' },
    ]).expect(400);

    expect((res.body as { error: string }).error).toBe('INVALID_UPLOAD_PARTS');
  });

  it('rejects-parts-without-etag', async () => {
    const session = await initiateUpload(app, userA);

    const res = await request(app.getHttpServer())
      .post(`/videos/${session.publicId}/upload/complete`)
      .set(authHeader(userA))
      .send({ parts: [{ partNumber: 1 }] })
      .expect(400);

    expect((res.body as { error: string }).error).toBe('VALIDATION_ERROR');
  });

  it('rejects-size-mismatch', async () => {
    const { session, parts } = await startAndUpload(new Uint8Array(1024), 2048);

    const res = await completeUpload(
      app,
      userA,
      session.publicId,
      parts,
    ).expect(422);

    expect((res.body as { error: string }).error).toBe('UPLOAD_SIZE_MISMATCH');
  });

  it('hides-video-from-other-user', async () => {
    const { session, parts } = await startAndUpload(new Uint8Array(1024));

    const res = await completeUpload(
      app,
      userB,
      session.publicId,
      parts,
    ).expect(404);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });

  it('requires-authentication', async () => {
    await request(app.getHttpServer())
      .post('/videos/abcdefghijk/upload/complete')
      .send({ parts: [{ partNumber: 1, etag: '"abc"' }] })
      .expect(401);
  });
});
