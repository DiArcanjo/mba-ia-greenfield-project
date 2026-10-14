import request from 'supertest';
import { DataSource } from 'typeorm';
import { MediaToolsService } from '../src/media/media-tools.service';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { generateTestVideo } from '../src/test/generate-test-video';
import { deleteKeysByPrefix } from '../src/test/storage';
import {
  authHeader,
  completeUpload,
  createVideoTestApp,
  initiateUpload,
  registerAndLogin,
  resetThrottler,
  uploadAllParts,
  waitForProcessing,
  type TestApp,
  type TestUser,
} from '../src/test/video-flow';
import { VideoProcessingService } from '../src/video-processing/video-processing.service';
import { Video } from '../src/videos/entities/video.entity';
import { VideosService } from '../src/videos/videos.service';

describe('GET /videos/:publicId (e2e)', () => {
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

  const getVideo = (user: TestUser | null, publicId: string) => {
    const req = request(app.getHttpServer()).get(`/videos/${publicId}`);
    return user ? req.set(authHeader(user)) : req;
  };

  it('returns-draft-after-initiate', async () => {
    const session = await initiateUpload(app, userA);

    const res = await getVideo(userA, session.publicId).expect(200);

    const body = res.body as Record<string, unknown>;
    expect(body.processingStatus).toBe('uploading');
    expect(body.publicationStatus).toBe('draft');
    expect(body.hasThumbnail).toBe(false);
    expect(body.durationSeconds).toBeNull();
    expect(body).not.toHaveProperty('id');
  });

  it('returns-metadata-when-ready', async () => {
    const content = await generateTestVideo();
    const session = await initiateUpload(app, userA, {
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      size: content.length,
    });
    const parts = await uploadAllParts(app, userA, session, content);
    await completeUpload(app, userA, session.publicId, parts).expect(202);
    // Processing runs the same idempotent service the video-worker uses; it is
    // invoked here directly because the worker entrypoint arrives in SI-03.22.
    const video = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ public_id: session.publicId });
    await new VideoProcessingService(
      app.get(VideosService),
      app.get(StorageService),
      new MediaToolsService(),
    ).process(video.id);

    await waitForProcessing(app, userA, session.publicId);
    const res = await getVideo(userA, session.publicId).expect(200);

    const body = res.body as Record<string, unknown>;
    expect(body.processingStatus).toBe('ready');
    expect(typeof body.durationSeconds).toBe('number');
    expect(body.width).toBe(320);
    expect(body.height).toBe(240);
    expect(body.videoCodec).toBe('h264');
    expect(body.formatName).toEqual(expect.any(String));
    expect(body.hasThumbnail).toBe(true);
  });

  it('unknown-public-id', async () => {
    const res = await getVideo(userA, 'doesnotexis').expect(404);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });

  it('hides-video-from-other-user', async () => {
    const session = await initiateUpload(app, userA);

    const res = await getVideo(userB, session.publicId).expect(404);

    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });

  it('requires-authentication', async () => {
    await getVideo(null, 'abcdefghijk').expect(401);
  });
});
