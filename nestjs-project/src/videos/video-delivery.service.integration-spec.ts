import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { ChannelsModule } from '../channels/channels.module';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import {
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { QueueModule } from '../queue/queue.module';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { getRangeViaUrl, deleteKeysByPrefix } from '../test/storage';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideoDeliveryService } from './video-delivery.service';
import { ProcessingStatus } from './video.types';
import { VideosModule } from './videos.module';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);

describe('VideoDeliveryService (integration, PostgreSQL + MinIO)', () => {
  let module: TestingModule;
  let service: VideoDeliveryService;
  let storage: StorageService;
  let dataSource: DataSource;
  let owner: User;
  let stranger: User;
  let video: Video;
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
        VideosModule,
      ],
    }).compile();
    service = module.get(VideoDeliveryService);
    storage = module.get(StorageService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await cleanAllTables(dataSource);
    await module.close();
    if (originalPrefix === undefined) delete process.env.QUEUE_PREFIX;
    else process.env.QUEUE_PREFIX = originalPrefix;
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const users = dataSource.getRepository(User);
    const channels = module.get(ChannelsService);
    owner = await users.save({ email: 'dl_owner@example.com', password: 'x' });
    stranger = await users.save({
      email: 'dl_other@example.com',
      password: 'x',
    });
    const channel = await channels.createChannel(owner.id, owner.email);
    await channels.createChannel(stranger.id, stranger.email);

    video = await dataSource.getRepository(Video).save({
      public_id: 'deliv000001',
      channel_id: channel.id,
      title: 'clip',
      original_filename: 'Minha Aula.mp4',
      content_type: 'video/mp4',
      size_bytes: 100,
      part_size_bytes: 5242880,
      storage_key: 'videos/deliv-test/original',
      thumbnail_key: 'videos/deliv-test/thumbnail.jpg',
      processing_status: ProcessingStatus.READY,
    });
    await storage.putObject(
      video.storage_key,
      Buffer.alloc(100, 1),
      'video/mp4',
    );
    await storage.putObject(video.thumbnail_key!, JPEG_BYTES, 'image/jpeg');
  });

  afterEach(async () => {
    await deleteKeysByPrefix('videos/deliv-test');
  });

  it('should return a stream URL that serves a 206 for Range bytes=0-9', async () => {
    const url = await service.getStreamUrl(owner.id, video.public_id);

    const response = await getRangeViaUrl(url, 'bytes=0-9');

    expect(response.status).toBe(206);
    expect((await response.arrayBuffer()).byteLength).toBe(10);
  });

  it('should return a download URL with Content-Disposition attachment and the filename', async () => {
    const url = await service.getDownloadUrl(owner.id, video.public_id);

    const response = await fetch(url);

    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(/^attachment/);
    expect(disposition).toContain('Minha%20Aula.mp4');
  });

  it('should return a thumbnail URL that serves image/jpeg', async () => {
    const url = await service.getThumbnailUrl(owner.id, video.public_id);

    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
  });

  it('should throw VideoNotReadyException while the video is not ready', async () => {
    await dataSource
      .getRepository(Video)
      .update(
        { id: video.id },
        { processing_status: ProcessingStatus.PROCESSING },
      );

    await expect(
      service.getStreamUrl(owner.id, video.public_id),
    ).rejects.toBeInstanceOf(VideoNotReadyException);
    await expect(
      service.getDownloadUrl(owner.id, video.public_id),
    ).rejects.toBeInstanceOf(VideoNotReadyException);
  });

  it('should throw VideoNotReadyException for the thumbnail when there is none', async () => {
    await dataSource
      .getRepository(Video)
      .update({ id: video.id }, { thumbnail_key: null });

    await expect(
      service.getThumbnailUrl(owner.id, video.public_id),
    ).rejects.toBeInstanceOf(VideoNotReadyException);
  });

  it('should throw VideoNotFoundException for another users video', async () => {
    for (const call of [
      () => service.getStreamUrl(stranger.id, video.public_id),
      () => service.getDownloadUrl(stranger.id, video.public_id),
      () => service.getThumbnailUrl(stranger.id, video.public_id),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(VideoNotFoundException);
    }
  });
});
