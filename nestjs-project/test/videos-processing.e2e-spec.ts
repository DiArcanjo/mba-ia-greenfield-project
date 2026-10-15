import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { generateTestVideo } from '../src/test/generate-test-video';
import { deleteKeysByPrefix } from '../src/test/storage';
import {
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

const FIVE_MIB = 5 * 1024 * 1024;

describe('Video processing pipeline (e2e, real worker)', () => {
  let app: TestApp;
  let dataSource: DataSource;
  let user: TestUser;
  const originalPartSize = process.env.VIDEO_PART_SIZE_BYTES;

  beforeAll(async () => {
    process.env.VIDEO_PART_SIZE_BYTES = String(FIVE_MIB);
    app = await createVideoTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await cleanAllTables(dataSource);
    await deleteKeysByPrefix('videos/');
    await app.close();
    if (originalPartSize === undefined)
      delete process.env.VIDEO_PART_SIZE_BYTES;
    else process.env.VIDEO_PART_SIZE_BYTES = originalPartSize;
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    resetThrottler(app);
    user = await registerAndLogin(app, 'owner@example.com');
  });

  it('takes an ffmpeg-generated MP4 uploaded in 2 parts to ready', async () => {
    // Real 2s H.264 MP4 plus a trailing `free` box so it spans exactly 2 parts.
    const content = await generateTestVideo(FIVE_MIB + 256 * 1024);
    const session = await initiateUpload(app, user, {
      filename: 'pipeline.mp4',
      contentType: 'video/mp4',
      size: content.length,
    });
    expect(session.upload.partSize).toBe(FIVE_MIB);
    expect(session.upload.partCount).toBe(2);
    const parts = await uploadAllParts(app, user, session, content);
    expect(parts).toHaveLength(2);

    await completeUpload(app, user, session.publicId, parts).expect(202);
    const video = await waitForProcessing(app, user, session.publicId);

    expect(video.processingStatus).toBe('ready');
    expect(video.durationSeconds).toEqual(expect.any(Number));
    expect(video.durationSeconds as number).toBeGreaterThan(1.9);
    expect(video.durationSeconds as number).toBeLessThan(2.1);
    expect(video.width).toBe(320);
    expect(video.height).toBe(240);
    expect(video.videoCodec).toBe('h264');
    expect(video.formatName).toEqual(expect.stringContaining('mp4'));
    expect(video.hasThumbnail).toBe(true);
    expect(video.failureReason).toBeNull();
  }, 90_000);

  it('ends failed with a failureReason for random bytes declared as video/mp4', async () => {
    const content = randomBytes(64 * 1024);
    const session = await initiateUpload(app, user, {
      filename: 'broken.mp4',
      contentType: 'video/mp4',
      size: content.length,
    });
    const parts = await uploadAllParts(app, user, session, content);

    await completeUpload(app, user, session.publicId, parts).expect(202);
    const video = await waitForProcessing(app, user, session.publicId);

    expect(video.processingStatus).toBe('failed');
    expect(typeof video.failureReason).toBe('string');
    expect((video.failureReason as string).length).toBeGreaterThan(0);
    // The presigned input URL (with its signature) must never reach the API.
    expect(video.failureReason).not.toContain('X-Amz-');
    expect(video.failureReason).not.toMatch(/https?:\/\//);
    expect(video.hasThumbnail).toBe(false);
  }, 90_000);
});
