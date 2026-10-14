import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { generateTestVideo } from '../test/generate-test-video';
import { deleteKeysByPrefix } from '../test/storage';
import { MediaToolsService } from './media-tools.service';
import { MediaProcessingError } from './media.types';

describe('MediaToolsService (integration, ffmpeg + MinIO)', () => {
  let media: MediaToolsService;
  let storage: StorageService;
  const prefix = `videos/${randomUUID()}`;
  let videoUrl: string;
  let invalidUrl: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
      providers: [MediaToolsService],
    }).compile();
    media = module.get(MediaToolsService);
    storage = module.get(StorageService);

    await storage.putObject(
      `${prefix}/valid`,
      await generateTestVideo(),
      'video/mp4',
    );
    await storage.putObject(
      `${prefix}/invalid`,
      Buffer.from('this is definitely not a video file '.repeat(200)),
      'video/mp4',
    );
    videoUrl = await storage.presignGetObject(`${prefix}/valid`, {
      expiresIn: 600,
    });
    invalidUrl = await storage.presignGetObject(`${prefix}/invalid`, {
      expiresIn: 600,
    });
  });

  afterAll(async () => {
    await deleteKeysByPrefix(prefix);
  });

  it('should probe duration, size and codec of a generated MP4', async () => {
    const metadata = await media.probe(videoUrl);

    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(240);
    expect(metadata.videoCodec).toBe('h264');
    expect(metadata.durationSeconds).toBeGreaterThan(1.9);
    expect(metadata.durationSeconds).toBeLessThan(2.1);
    expect(metadata.formatName).toContain('mp4');
  });

  it('should extract a JPEG thumbnail', async () => {
    const jpeg = await media.extractThumbnail(videoUrl, 1);

    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);
  });

  it('should fail non-retryably for an object that is not a video', async () => {
    const error = await media.probe(invalidUrl).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MediaProcessingError);
    expect((error as MediaProcessingError).retryable).toBe(false);
  });

  it('should fail retryably for a URL of a non-existent object', async () => {
    const missingUrl = await storage.presignGetObject(`${prefix}/missing`, {
      expiresIn: 600,
    });

    const error = await media.probe(missingUrl).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MediaProcessingError);
    expect((error as MediaProcessingError).retryable).toBe(true);
  });
});
