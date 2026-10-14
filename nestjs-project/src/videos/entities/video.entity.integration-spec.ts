import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { ProcessingStatus, PublicationStatus } from '../video.types';
import { Video } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channel: Channel;
  let counter = 0;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource.getRepository(User).save({
      email: `video_owner_${++counter}@example.com`,
      password: 'hashed',
    });
    channel = await dataSource.getRepository(Channel).save({
      name: 'Owner',
      nickname: `owner${counter}`,
      user_id: user.id,
    });
  });

  function buildVideo(overrides: Partial<Video> = {}): Partial<Video> {
    const n = ++counter;
    return {
      public_id: `pub${String(n).padStart(8, '0')}`,
      channel_id: channel.id,
      title: 'clip',
      original_filename: 'clip.mp4',
      content_type: 'video/mp4',
      size_bytes: 1024,
      storage_key: `videos/${n}/original`,
      part_size_bytes: 5242880,
      ...overrides,
    };
  }

  it('should reject two videos with the same public_id', async () => {
    await videoRepository.save(buildVideo({ public_id: 'duplicated1' }));

    await expect(
      videoRepository.save(buildVideo({ public_id: 'duplicated1' })),
    ).rejects.toThrow();
  });

  it('should default to uploading and draft statuses', async () => {
    const saved = await videoRepository.save(buildVideo());

    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.processing_status).toBe(ProcessingStatus.UPLOADING);
    expect(found.publication_status).toBe(PublicationStatus.DRAFT);
    expect(found.upload_id).toBeNull();
  });

  it('should round-trip size_bytes above 2^31 as a number', async () => {
    const saved = await videoRepository.save(
      buildVideo({ size_bytes: 10737418240 }),
    );

    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.size_bytes).toBe(10737418240);
  });

  it('should round-trip duration_seconds as a number', async () => {
    const saved = await videoRepository.save(
      buildVideo({ duration_seconds: 12.345 }),
    );

    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.duration_seconds).toBe(12.345);
  });

  it('should reject a video with a non-existent channel_id', async () => {
    await expect(
      videoRepository.save(
        buildVideo({ channel_id: '00000000-0000-0000-0000-000000000000' }),
      ),
    ).rejects.toThrow();
  });

  it('should accept every processing and publication status value', async () => {
    for (const processing_status of Object.values(ProcessingStatus)) {
      await videoRepository.save(buildVideo({ processing_status }));
    }
    await videoRepository.save(
      buildVideo({ publication_status: PublicationStatus.PUBLISHED }),
    );

    expect(await videoRepository.count()).toBe(5);
  });
});
