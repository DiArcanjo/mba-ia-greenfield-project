import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { ChannelsModule } from '../channels/channels.module';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { MediaToolsService } from '../media/media-tools.service';
import { MediaProcessingError } from '../media/media.types';
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
import { VIDEO_PROCESSING_QUEUE } from '../videos/video-processing.constants';
import { VideoProcessingProducer } from '../videos/video-processing.producer';
import { ProcessingStatus } from '../videos/video.types';
import { VideoProcessingModule } from './video-processing.module';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideoProcessingProcessor (integration, Redis + PostgreSQL + MinIO + ffmpeg)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let storage: StorageService;
  let producer: VideoProcessingProducer;
  let media: MediaToolsService;
  let queue: Queue;
  let channelId: string;
  const savedEnv = {
    prefix: process.env.QUEUE_PREFIX,
    backoff: process.env.VIDEO_PROCESSING_BACKOFF_MS,
    attempts: process.env.VIDEO_PROCESSING_ATTEMPTS,
  };

  beforeAll(async () => {
    process.env.QUEUE_PREFIX = `test-${Date.now()}-${process.pid}`;
    process.env.VIDEO_PROCESSING_BACKOFF_MS = '50';
    process.env.VIDEO_PROCESSING_ATTEMPTS = '3';
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
    await module.init();
    dataSource = module.get(DataSource);
    videoRepository = dataSource.getRepository(Video);
    storage = module.get(StorageService, { strict: false });
    producer = module.get(VideoProcessingProducer, { strict: false });
    media = module.get(MediaToolsService, { strict: false });
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE), {
      strict: false,
    });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await cleanAllTables(dataSource);
    await module.close();
    for (const [key, value] of Object.entries({
      QUEUE_PREFIX: savedEnv.prefix,
      VIDEO_PROCESSING_BACKOFF_MS: savedEnv.backoff,
      VIDEO_PROCESSING_ATTEMPTS: savedEnv.attempts,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource
      .getRepository(User)
      .save({ email: 'proc_owner@example.com', password: 'x' });
    channelId = (
      await module.get(ChannelsService).createChannel(user.id, user.email)
    ).id;
  });

  const createdIds: string[] = [];
  afterEach(async () => {
    jest.restoreAllMocks();
    for (const id of createdIds.splice(0)) {
      await deleteKeysByPrefix(`videos/${id}`);
    }
  });

  async function enqueueVideo(content: Buffer): Promise<Video> {
    const id = randomUUID();
    createdIds.push(id);
    const key = `videos/${id}/original`;
    await storage.putObject(key, content, 'video/mp4');
    const video = await videoRepository.save({
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
    await producer.enqueue(id);
    return video;
  }

  async function waitForTerminal(id: string): Promise<Video> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const video = await videoRepository.findOneByOrFail({ id });
      if (
        video.processing_status === ProcessingStatus.READY ||
        video.processing_status === ProcessingStatus.FAILED
      ) {
        return video;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Video ${id} did not reach a terminal status`);
  }

  it('should take a valid MP4 job to ready', async () => {
    const video = await enqueueVideo(await generateTestVideo());

    const done = await waitForTerminal(video.id);

    expect(done.processing_status).toBe(ProcessingStatus.READY);
    expect(done.thumbnail_key).toBe(`videos/${video.id}/thumbnail.jpg`);
  });

  it('should retry a transient failure and still reach ready', async () => {
    const probe = jest
      .spyOn(media, 'probe')
      .mockRejectedValueOnce(new MediaProcessingError('network blip', true));
    const video = await enqueueVideo(await generateTestVideo());

    const done = await waitForTerminal(video.id);

    expect(done.processing_status).toBe(ProcessingStatus.READY);
    expect(probe.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('should mark the video failed with a reason after exhausting attempts', async () => {
    const probe = jest
      .spyOn(media, 'probe')
      .mockRejectedValue(new MediaProcessingError('storage down', true));
    const video = await enqueueVideo(await generateTestVideo());

    const done = await waitForTerminal(video.id);

    expect(done.processing_status).toBe(ProcessingStatus.FAILED);
    expect(done.failure_reason).toContain('storage down');
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it('should fail a non-video file without consuming every attempt', async () => {
    const probe = jest.spyOn(media, 'probe');
    const video = await enqueueVideo(
      Buffer.from('this is definitely not a video file '.repeat(200)),
    );

    const done = await waitForTerminal(video.id);

    expect(done.processing_status).toBe(ProcessingStatus.FAILED);
    expect(done.failure_reason).toBeTruthy();
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
