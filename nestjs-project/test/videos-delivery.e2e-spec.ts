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

describe('Video delivery (e2e, real worker and MinIO)', () => {
  let app: TestApp;
  let dataSource: DataSource;
  let userA: TestUser;
  let userB: TestUser;
  let ready: { publicId: string; size: number };

  beforeAll(async () => {
    app = await createVideoTestApp();
    dataSource = app.get(DataSource);
    await cleanAllTables(dataSource);
    resetThrottler(app);
    userA = await registerAndLogin(app, 'owner-a@example.com');
    userB = await registerAndLogin(app, 'owner-b@example.com');
    ready = await createReadyVideo(app, userA, 'Aula Final.mp4');
  }, 90_000);

  afterAll(async () => {
    await cleanAllTables(dataSource);
    await deleteKeysByPrefix('videos/');
    await app.close();
  });

  const get = (user: TestUser | null, path: string) => {
    const req = request(app.getHttpServer()).get(path);
    return user ? req.set(authHeader(user)) : req;
  };
  const errorOf = (res: request.Response) =>
    (res.body as { error: string }).error;

  it('GET /videos/:publicId reports the ready video', async () => {
    const res = await get(userA, `/videos/${ready.publicId}`).expect(200);

    expect(res.body).toMatchObject({
      processingStatus: 'ready',
      hasThumbnail: true,
      sizeBytes: ready.size,
    });
  });

  it('streams with 206 through the redirect URL on a Range request', async () => {
    const res = await get(userA, `/videos/${ready.publicId}/stream`)
      .redirects(0)
      .expect(302);

    const ranged = await fetch(res.headers.location, {
      headers: { Range: 'bytes=0-1023' },
    });

    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toMatch(/^bytes 0-1023\//);
    expect((await ranged.arrayBuffer()).byteLength).toBe(1024);
  });

  it('downloads with Content-Disposition attachment and the full body', async () => {
    const res = await get(userA, `/videos/${ready.publicId}/download`)
      .redirects(0)
      .expect(302);

    const file = await fetch(res.headers.location);

    expect(file.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(file.headers.get('content-disposition')).toContain(
      encodeURIComponent('Aula Final.mp4'),
    );
    expect((await file.arrayBuffer()).byteLength).toBe(ready.size);
  });

  it('serves the thumbnail as image/jpeg through the redirect', async () => {
    const res = await get(userA, `/videos/${ready.publicId}/thumbnail`)
      .redirects(0)
      .expect(302);

    const image = await fetch(res.headers.location);

    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/jpeg');
  });

  it('answers 409 VIDEO_NOT_READY on delivery routes before processing', async () => {
    const draft = await initiateUpload(app, userA);

    for (const route of ['stream', 'download', 'thumbnail']) {
      const res = await get(userA, `/videos/${draft.publicId}/${route}`).expect(
        409,
      );
      expect(errorOf(res)).toBe('VIDEO_NOT_READY');
    }
  });

  it('answers 404 VIDEO_NOT_FOUND to another user on every delivery route', async () => {
    for (const route of ['', '/stream', '/download', '/thumbnail']) {
      const res = await get(userB, `/videos/${ready.publicId}${route}`).expect(
        404,
      );
      expect(errorOf(res)).toBe('VIDEO_NOT_FOUND');
    }
  });

  it('answers 401 without a token on every delivery route', async () => {
    for (const route of ['', '/stream', '/download', '/thumbnail']) {
      await get(null, `/videos/${ready.publicId}${route}`).expect(401);
    }
  });
});
