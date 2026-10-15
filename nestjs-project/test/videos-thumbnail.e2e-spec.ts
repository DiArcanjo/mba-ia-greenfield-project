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

describe('GET /videos/:publicId/thumbnail (e2e)', () => {
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

  const thumbnail = (user: TestUser | null, publicId: string) => {
    const req = request(app.getHttpServer()).get(
      `/videos/${publicId}/thumbnail`,
    );
    return user ? req.set(authHeader(user)) : req;
  };

  it('redirects-to-jpeg', async () => {
    const { publicId } = await createReadyVideo(app, userA);

    const res = await thumbnail(userA, publicId).redirects(0).expect(302);

    const image = await fetch(res.headers.location);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/jpeg');
    const bytes = new Uint8Array(await image.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  });

  it('rejects-video-without-thumbnail', async () => {
    const session = await initiateUpload(app, userA);

    const res = await thumbnail(userA, session.publicId).expect(409);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_READY');
  });

  it('hides-video-from-other-user', async () => {
    const { publicId } = await createReadyVideo(app, userA);

    const res = await thumbnail(userB, publicId).expect(404);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });

  it('requires-authentication', async () => {
    await thumbnail(null, 'abcdefghijk').expect(401);
  });
});
