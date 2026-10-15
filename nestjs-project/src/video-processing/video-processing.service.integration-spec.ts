import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnrecoverableError } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { QueueModule } from '../queue/queue.module';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { generateTestVideo } from '../test/generate-test-video';
import { deleteKeysByPrefix } from '../test/storage';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { ProcessingStatus } from '../videos/video.types';
import { VideoProcessingModule } from './video-processing.module';
import { VideoProcessingService } from './video-processing.service';
import { ChannelsModule } from '../channels/channels.module';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideoProcessingService (integration, PostgreSQL + MinIO + ffmpeg)', () => {
  let module: TestingModule;
  let service: VideoProcessingService;
  let storage: StorageService;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channelId: string;
  const originalPrefix = process.env.QUEUE_PREFIX;

  beforeAll(async () => {
    process.env.QUEUE_PREFIX = `test-${Date.now()}-${process.pid}`;
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [queueConfig, storageConfig, videoConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        QueueModule,
        ChannelsModule,
        VideoProcessingModule,
      ],
    }).compile();
    service = module.get(VideoProcessingService);
    storage = module.get(StorageService);
    dataSource = module.get(DataSource);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await cleanAllTables(dataSource);
    await module.close();
    if (originalPrefix === undefined) delete process.env.QUEUE_PREFIX;
    else process.env.QUEUE_PREFIX = originalPrefix;
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource
      .getRepository(User)
      .save({ email: 'vp_owner@example.com', password: 'x' });
    channelId = (
      await module.get(ChannelsService).createChannel(user.id, user.email)
    ).id;
  });

  const createdIds: string[] = [];
  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await deleteKeysByPrefix(`videos/${id}`);
    }
  });

  async function createProcessingVideo(content: Buffer): Promise<Video> {
    const id = randomUUID();
    createdIds.push(id);
    const key = `videos/${id}/original`;
    await storage.putObject(key, content, 'video/mp4');
    return videoRepository.save({
      id,
      public_id: id.slice(0, 11),
      channel_id: channelId,
      title: 'clip',
      original_filename: 'clip.mp4',
      content_type: 'video/mp4',
      size_bytes: content.length,
      storage_key: key,
      part_size_bytes: 5242880,
      processing_status: ProcessingStatus.PROCESSING,
    });
  }

  it('should leave a valid MP4 ready with metadata and a JPEG thumbnail', async () => {
    const video = await createProcessingVideo(await generateTestVideo());

    await service.process(video.id);

    const found = await videoRepository.findOneByOrFail({ id: video.id });
    expect(found.processing_status).toBe(ProcessingStatus.READY);
    expect(found.duration_seconds).toBeGreaterThan(1.9);
    expect(found.duration_seconds).toBeLessThan(2.1);
    expect(found.width).toBe(320);
    expect(found.height).toBe(240);
    expect(found.video_codec).toBe('h264');
    expect(found.thumbnail_key).toBe(`videos/${video.id}/thumbnail.jpg`);
    const head = await storage.headObject(found.thumbnail_key!);
    expect(head.contentType).toBe('image/jpeg');
  });

  it('should not touch a video that is already ready', async () => {
    const video = await createProcessingVideo(await generateTestVideo());
    await service.process(video.id);
    const before = await videoRepository.findOneByOrFail({ id: video.id });
    const putSpy = jest.spyOn(storage, 'putObject');

    await service.process(video.id);

    const after = await videoRepository.findOneByOrFail({ id: video.id });
    expect(putSpy).not.toHaveBeenCalled();
    expect(after.updated_at).toEqual(before.updated_at);
    putSpy.mockRestore();
  });

  it('should throw UnrecoverableError for an object that is not a video', async () => {
    const video = await createProcessingVideo(Buffer.alloc(4096, 7));

    await expect(service.process(video.id)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    const found = await videoRepository.findOneByOrFail({ id: video.id });
    expect(found.processing_status).toBe(ProcessingStatus.PROCESSING);
    expect(found.duration_seconds).toBeNull();
  });
});
