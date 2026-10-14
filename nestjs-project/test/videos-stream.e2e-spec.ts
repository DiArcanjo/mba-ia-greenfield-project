import request from 'supertest';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { deleteKeysByPrefix } from '../src/test/storage';
import {
  authHeader,
  createReadyVideo,
  createVideoTestApp,
  initiateUpload,
  registerAndLogin,
  resetThrottler,
  type TestApp,
  type TestUser,
} from '../src/test/video-flow';

describe('GET /videos/:publicId/stream (e2e)', () => {
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

  const stream = (user: TestUser | null, publicId: string) => {
    const req = request(app.getHttpServer()).get(`/videos/${publicId}/stream`);
    return user ? req.set(authHeader(user)) : req;
  };

  it('redirects-to-minio and serves 206 for a Range request', async () => {
    const { publicId } = await createReadyVideo(app, userA);

    const res = await stream(userA, publicId).redirects(0).expect(302);

    const location = res.headers.location;
    expect(location).toContain('minio:9000');

    const ranged = await fetch(location, {
      headers: { Range: 'bytes=0-1023' },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toMatch(/^bytes 0-1023\//);
    expect((await ranged.arrayBuffer()).byteLength).toBe(1024);
  });

  it('rejects-video-not-ready', async () => {
    const session = await initiateUpload(app, userA);

    const res = await stream(userA, session.publicId).expect(409);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_READY');
  });

  it('hides-video-from-other-user', async () => {
    const { publicId } = await createReadyVideo(app, userA);

    const res = await stream(userB, publicId).expect(404);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });

  it('requires-authentication', async () => {
    await stream(null, 'abcdefghijk').expect(401);
  });
});
