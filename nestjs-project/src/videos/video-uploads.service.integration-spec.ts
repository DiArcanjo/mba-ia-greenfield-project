import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import { ChannelsModule } from '../channels/channels.module';
import { ChannelsService } from '../channels/channels.service';
import { VideoTooLargeException } from '../common/exceptions/domain.exception';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { QueueModule } from '../queue/queue.module';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { deleteKeysByPrefix, uploadPartViaPresignedUrl } from '../test/storage';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideoUploadsService } from './video-uploads.service';
import { VideosModule } from './videos.module';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideoUploadsService.initiate (integration, PostgreSQL + MinIO)', () => {
  let module: TestingModule;
  let service: VideoUploadsService;
  let storage: StorageService;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channelsService: ChannelsService;
  let userId: string;
  const originalPrefix = process.env.QUEUE_PREFIX;
  const originalPartSize = process.env.VIDEO_PART_SIZE_BYTES;

  beforeAll(async () => {
    process.env.QUEUE_PREFIX = `test-${Date.now()}-${process.pid}`;
    process.env.VIDEO_PART_SIZE_BYTES = '5242880';
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
    service = module.get(VideoUploadsService);
    storage = module.get(StorageService);
    dataSource = module.get(DataSource);
    channelsService = module.get(ChannelsService);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await cleanAllTables(dataSource);
    await module.close();
    if (originalPrefix === undefined) delete process.env.QUEUE_PREFIX;
    else process.env.QUEUE_PREFIX = originalPrefix;
    if (originalPartSize === undefined)
      delete process.env.VIDEO_PART_SIZE_BYTES;
    else process.env.VIDEO_PART_SIZE_BYTES = originalPartSize;
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource
      .getRepository(User)
      .save({ email: `vu_${Date.now()}@example.com`, password: 'hashed' });
    await channelsService.createChannel(user.id, user.email);
    userId = user.id;
  });

  afterEach(async () => {
    const videos = await videoRepository.find();
    for (const v of videos) await deleteKeysByPrefix(`videos/${v.id}`);
  });

  const dto = {
    filename: 'aula.mp4',
    contentType: 'video/mp4',
    size: 12 * 1024 * 1024,
  };

  it('should persist an uploading draft whose upload_id accepts a part', async () => {
    const result = await service.initiate(userId, dto);

    const video = await videoRepository.findOneByOrFail({
      public_id: result.publicId,
    });
    expect(video.processing_status).toBe('uploading');
    expect(video.publication_status).toBe('draft');
    expect(video.upload_id).toBe(result.upload.uploadId);
    expect(video.part_size_bytes).toBe(5242880);
    expect(result.upload.partCount).toBe(3);

    const url = await storage.presignUploadPart(
      video.storage_key,
      video.upload_id!,
      1,
      600,
    );
    await uploadPartViaPresignedUrl(url, new Uint8Array(5242880));
    const parts = await storage.listParts(video.storage_key, video.upload_id!);
    expect(parts.map((p) => p.partNumber)).toEqual([1]);
  });

  it('should abort the real multipart upload when the insert fails', async () => {
    const created: { key?: string; uploadId?: string } = {};
    const original = storage.createMultipartUpload.bind(
      storage,
    ) as StorageService['createMultipartUpload'];
    jest
      .spyOn(storage, 'createMultipartUpload')
      .mockImplementation(async (key, contentType) => {
        created.key = key;
        const uploadId = await original(key, contentType);
        created.uploadId = uploadId;
        return uploadId;
      });
    const failure = new Error('forced insert failure');
    jest.spyOn(videoRepository, 'save').mockRejectedValue(failure);

    await expect(service.initiate(userId, dto)).rejects.toBe(failure);

    await expect(
      storage.listParts(created.key!, created.uploadId!),
    ).rejects.toThrow();
    expect(await videoRepository.count()).toBe(0);
    jest.restoreAllMocks();
  });

  it('should not create a row nor a multipart upload above the size limit', async () => {
    const spy = jest.spyOn(storage, 'createMultipartUpload');

    await expect(
      service.initiate(userId, { ...dto, size: 10737418240 + 1 }),
    ).rejects.toBeInstanceOf(VideoTooLargeException);

    expect(spy).not.toHaveBeenCalled();
    expect(await videoRepository.count()).toBe(0);
    spy.mockRestore();
  });
});
