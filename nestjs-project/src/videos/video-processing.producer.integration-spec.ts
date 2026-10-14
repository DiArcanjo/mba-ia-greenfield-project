import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import { QueueModule } from '../queue/queue.module';
import { createTestDataSource } from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
} from './video-processing.constants';
import { VideoProcessingProducer } from './video-processing.producer';
import { VideosModule } from './videos.module';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideoProcessingProducer (integration, Redis)', () => {
  let module: TestingModule;
  let producer: VideoProcessingProducer;
  let queue: Queue;
  const originalPrefix = process.env.QUEUE_PREFIX;
  const testPrefix = `test-${randomUUID()}`;

  beforeAll(async () => {
    // Unique prefix keeps the Compose video-worker from consuming test jobs.
    process.env.QUEUE_PREFIX = testPrefix;
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        QueueModule,
        VideosModule,
      ],
    }).compile();
    producer = module.get(VideoProcessingProducer);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await module.close();
    if (originalPrefix === undefined) delete process.env.QUEUE_PREFIX;
    else process.env.QUEUE_PREFIX = originalPrefix;
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
  });

  it('should enqueue a process-video job with payload, attempts and exponential backoff', async () => {
    const videoId = randomUUID();

    await producer.enqueue(videoId);

    const job = await queue.getJob(videoId);
    expect(job).toBeDefined();
    expect(job!.name).toBe(PROCESS_VIDEO_JOB);
    expect(job!.data).toEqual({ videoId });
    expect(job!.opts.jobId).toBe(videoId);
    expect(job!.opts.attempts).toBe(
      Number(process.env.VIDEO_PROCESSING_ATTEMPTS ?? 3),
    );
    expect(job!.opts.backoff).toEqual({
      type: 'exponential',
      delay: Number(process.env.VIDEO_PROCESSING_BACKOFF_MS ?? 5000),
    });
  });

  it('should keep a single job when the same videoId is enqueued twice', async () => {
    const videoId = randomUUID();

    await producer.enqueue(videoId);
    await producer.enqueue(videoId);

    const counts = await queue.getJobCounts('waiting', 'delayed', 'active');
    expect(counts.waiting + counts.delayed + counts.active).toBe(1);
  });

  it('should not expose the job under the default streamtube prefix', async () => {
    const videoId = randomUUID();
    await producer.enqueue(videoId);

    const defaultPrefixQueue = new Queue(VIDEO_PROCESSING_QUEUE, {
      connection: {
        host: process.env.REDIS_HOST ?? 'redis',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
      prefix: 'streamtube',
    });
    try {
      expect(await defaultPrefixQueue.getJob(videoId)).toBeUndefined();
    } finally {
      await defaultPrefixQueue.close();
    }
  });
});
