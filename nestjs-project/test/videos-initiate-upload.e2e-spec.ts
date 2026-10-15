import request from 'supertest';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { deleteKeysByPrefix } from '../src/test/storage';
import {
  authHeader,
  createVideoTestApp,
  registerAndLogin,
  resetThrottler,
  type TestApp,
  type TestUser,
} from '../src/test/video-flow';

const VALID_BODY = {
  filename: 'aula.mp4',
  contentType: 'video/mp4',
  size: 12582912,
};

describe('POST /videos (e2e)', () => {
  let app: TestApp;
  let dataSource: DataSource;
  let userA: TestUser;

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
  });

  it('creates-draft-and-session', async () => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set(authHeader(userA))
      .send(VALID_BODY)
      .expect(201);

    const body = res.body as Record<string, unknown> & {
      upload: Record<string, unknown>;
    };
    expect(body.publicId).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(body.processingStatus).toBe('uploading');
    expect(body.publicationStatus).toBe('draft');
    expect(body.title).toBe('aula');
    expect(typeof body.upload.uploadId).toBe('string');
    expect(body.upload.partSize).toEqual(expect.any(Number));
    expect(body.upload.partCount).toBe(
      Math.ceil(VALID_BODY.size / (body.upload.partSize as number)),
    );
  });

  it('rejects-too-large', async () => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set(authHeader(userA))
      .send({ ...VALID_BODY, size: 10737418241 })
      .expect(413);

    expect((res.body as { error: string }).error).toBe('VIDEO_TOO_LARGE');
  });

  it('rejects-invalid-content-type', async () => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set(authHeader(userA))
      .send({ ...VALID_BODY, contentType: 'image/png' })
      .expect(400);

    expect((res.body as { error: string }).error).toBe('VALIDATION_ERROR');
  });

  it('rejects-unknown-property', async () => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set(authHeader(userA))
      .send({ ...VALID_BODY, unexpected: true })
      .expect(400);

    expect((res.body as { error: string }).error).toBe('VALIDATION_ERROR');
  });

  it('requires-authentication', async () => {
    await request(app.getHttpServer())
      .post('/videos')
      .send(VALID_BODY)
      .expect(401);
  });
});
