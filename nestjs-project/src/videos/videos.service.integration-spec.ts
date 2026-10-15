import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import { VideoNotFoundException } from '../common/exceptions/domain.exception';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { ProcessingStatus } from './video.types';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

const METADATA = {
  durationSeconds: 61.25,
  width: 1920,
  height: 1080,
  videoCodec: 'h264',
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  thumbnailKey: 'videos/x/thumbnail.jpg',
};

describe('VideosService (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let service: VideosService;
  let counter = 0;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
    service = new VideosService(videoRepository);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function createOwner() {
    const n = ++counter;
    const user = await dataSource
      .getRepository(User)
      .save({ email: `vs_${n}@example.com`, password: 'hashed' });
    const channel = await dataSource
      .getRepository(Channel)
      .save({ name: 'Owner', nickname: `vsowner${n}`, user_id: user.id });
    return { user, channel };
  }

  async function createVideo(
    channelId: string,
    overrides: Partial<Video> = {},
  ): Promise<Video> {
    const n = ++counter;
    return videoRepository.save({
      public_id: `vs${String(n).padStart(9, '0')}`,
      channel_id: channelId,
      title: 'clip',
      original_filename: 'clip.mp4',
      content_type: 'video/mp4',
      size_bytes: 1024,
      storage_key: `videos/${n}/original`,
      part_size_bytes: 5242880,
      upload_id: 'upload-1',
      ...overrides,
    });
  }

  describe('findOwnedByPublicId', () => {
    it('should return the video for its owner', async () => {
      const { user, channel } = await createOwner();
      const video = await createVideo(channel.id);

      const found = await service.findOwnedByPublicId(video.public_id, user.id);

      expect(found.id).toBe(video.id);
    });

    it('should throw VideoNotFoundException for another user', async () => {
      const { channel } = await createOwner();
      const { user: stranger } = await createOwner();
      const video = await createVideo(channel.id);

      await expect(
        service.findOwnedByPublicId(video.public_id, stranger.id),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });

    it('should throw VideoNotFoundException for an unknown publicId', async () => {
      const { user } = await createOwner();

      await expect(
        service.findOwnedByPublicId('missing1234', user.id),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });
  });

  describe('findById', () => {
    it('should return the video or null', async () => {
      const { channel } = await createOwner();
      const video = await createVideo(channel.id);

      expect((await service.findById(video.id))!.public_id).toBe(
        video.public_id,
      );
      expect(
        await service.findById('00000000-0000-0000-0000-000000000000'),
      ).toBeNull();
    });
  });

  describe('transitions', () => {
    it('should go uploading → processing → ready persisting metadata', async () => {
      const { channel } = await createOwner();
      const video = await createVideo(channel.id, { failure_reason: 'old' });

      expect(await service.markProcessing(video.id)).toBe(true);
      expect(await service.markReady(video.id, METADATA)).toBe(true);

      const found = await videoRepository.findOneByOrFail({ id: video.id });
      expect(found.processing_status).toBe(ProcessingStatus.READY);
      expect(found.upload_id).toBeNull();
      expect(found.duration_seconds).toBe(61.25);
      expect(found.width).toBe(1920);
      expect(found.height).toBe(1080);
      expect(found.video_codec).toBe('h264');
      expect(found.format_name).toBe(METADATA.formatName);
      expect(found.thumbnail_key).toBe(METADATA.thumbnailKey);
      expect(found.failure_reason).toBeNull();
    });

    it('should return false and leave the row untouched on out-of-order transitions', async () => {
      const { channel } = await createOwner();
      const video = await createVideo(channel.id);

      expect(await service.markReady(video.id, METADATA)).toBe(false);

      const found = await videoRepository.findOneByOrFail({ id: video.id });
      expect(found.processing_status).toBe(ProcessingStatus.UPLOADING);
      expect(found.duration_seconds).toBeNull();
      expect(found.upload_id).toBe('upload-1');
    });

    it('should return false when markProcessing runs twice', async () => {
      const { channel } = await createOwner();
      const video = await createVideo(channel.id);

      expect(await service.markProcessing(video.id)).toBe(true);
      expect(await service.markProcessing(video.id)).toBe(false);
    });

    it('should persist failed with the reason truncated to 500 characters', async () => {
      const { channel } = await createOwner();
      const video = await createVideo(channel.id);
      await service.markProcessing(video.id);

      expect(await service.markFailed(video.id, 'x'.repeat(800))).toBe(true);

      const found = await videoRepository.findOneByOrFail({ id: video.id });
      expect(found.processing_status).toBe(ProcessingStatus.FAILED);
      expect(found.failure_reason).toHaveLength(500);
    });

    it('should not change a terminal video on markFailed', async () => {
      const { channel } = await createOwner();
      const video = await createVideo(channel.id);
      await service.markProcessing(video.id);
      await service.markReady(video.id, METADATA);

      expect(await service.markFailed(video.id, 'late')).toBe(false);

      const found = await videoRepository.findOneByOrFail({ id: video.id });
      expect(found.processing_status).toBe(ProcessingStatus.READY);
    });
  });
});
