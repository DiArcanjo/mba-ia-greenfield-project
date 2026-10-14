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

describe('GET /videos/:publicId/download (e2e)', () => {
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

  const download = (user: TestUser | null, publicId: string) => {
    const req = request(app.getHttpServer()).get(
      `/videos/${publicId}/download`,
    );
    return user ? req.set(authHeader(user)) : req;
  };

  it('redirects-to-minio and forces attachment with the original filename', async () => {
    const { publicId, size, filename } = await createReadyVideo(
      app,
      userA,
      'minha aula.mp4',
    );

    const res = await download(userA, publicId).redirects(0).expect(302);

    const location = res.headers.location;
    expect(location).toContain('minio:9000');
    const file = await fetch(location);
    expect(file.status).toBe(200);
    const disposition = file.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(/^attachment/);
    expect(disposition).toContain(encodeURIComponent('minha aula.mp4'));
    expect(filename).toBe('minha aula.mp4');
    expect((await file.arrayBuffer()).byteLength).toBe(size);
  });

  it('rejects-video-not-ready', async () => {
    const session = await initiateUpload(app, userA);

    const res = await download(userA, session.publicId).expect(409);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_READY');
  });

  it('hides-video-from-other-user', async () => {
    const { publicId } = await createReadyVideo(app, userA);

    const res = await download(userB, publicId).expect(404);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });

  it('requires-authentication', async () => {
    await download(null, 'abcdefghijk').expect(401);
  });
});
