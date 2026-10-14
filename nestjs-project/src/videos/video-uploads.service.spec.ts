import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
import { Video } from './entities/video.entity';
import { PUBLIC_ID_PATTERN } from './public-id.util';
import { VideoUploadsService } from './video-uploads.service';

const FIVE_MIB = 5242880;

function collision(): QueryFailedError {
  const err = new QueryFailedError('INSERT', [], new Error('duplicate'));
  Object.assign(err, {
    code: '23505',
    detail: 'Key (public_id)=(abc) already exists.',
  });
  return err;
}

describe('VideoUploadsService.initiate', () => {
  let service: VideoUploadsService;
  const repository = { create: jest.fn(), save: jest.fn() };
  const channelsService = { findByUserId: jest.fn() };
  const storage = {
    createMultipartUpload: jest.fn(),
    abortMultipartUpload: jest.fn(),
  };
  const dto = {
    filename: 'aula.final.mp4',
    contentType: 'video/mp4',
    size: 12 * 1024 * 1024,
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    process.env.VIDEO_PART_SIZE_BYTES = String(FIVE_MIB);
    channelsService.findByUserId.mockResolvedValue({ id: 'channel-1' });
    storage.createMultipartUpload.mockResolvedValue('upload-1');
    repository.create.mockImplementation((v: Partial<Video>) => v);
    repository.save.mockImplementation((v: Partial<Video>) =>
      Promise.resolve(v),
    );
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [videoConfig] })],
      providers: [
        VideoUploadsService,
        { provide: getRepositoryToken(Video), useValue: repository },
        { provide: ChannelsService, useValue: channelsService },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(VideoUploadsService);
  });

  afterAll(() => {
    delete process.env.VIDEO_PART_SIZE_BYTES;
  });

  it('should throw ChannelNotFoundException when the user has no channel', async () => {
    channelsService.findByUserId.mockResolvedValue(null);

    await expect(service.initiate('u', dto)).rejects.toBeInstanceOf(
      ChannelNotFoundException,
    );
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('should reject sizes above the limit without touching storage or the DB', async () => {
    await expect(
      service.initiate('u', { ...dto, size: 10737418240 + 1 }),
    ).rejects.toBeInstanceOf(VideoTooLargeException);
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('should return the session with ceil(size / partSize) parts and a title without extension', async () => {
    const result = await service.initiate('u', dto);

    expect(result.upload).toEqual({
      uploadId: 'upload-1',
      partSize: FIVE_MIB,
      partCount: 3,
    });
    expect(result.title).toBe('aula.final');
    expect(result.processingStatus).toBe('uploading');
    expect(result.publicationStatus).toBe('draft');
    expect(result.publicId).toMatch(PUBLIC_ID_PATTERN);
  });

  it('should retry with a new public_id on a unique collision', async () => {
    repository.save
      .mockRejectedValueOnce(collision())
      .mockImplementation((v: Partial<Video>) => Promise.resolve(v));

    const result = await service.initiate('u', dto);

    expect(repository.save).toHaveBeenCalledTimes(2);
    expect(result.publicId).toMatch(PUBLIC_ID_PATTERN);
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it('should abort the multipart and rethrow after exhausting public_id retries', async () => {
    repository.save.mockRejectedValue(collision());

    await expect(service.initiate('u', dto)).rejects.toBeInstanceOf(
      QueryFailedError,
    );
    expect(repository.save).toHaveBeenCalledTimes(5);
    expect(storage.abortMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it('should abort the multipart and rethrow the original error when the insert fails', async () => {
    const failure = new Error('db down');
    repository.save.mockRejectedValue(failure);

    await expect(service.initiate('u', dto)).rejects.toBe(failure);
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^videos\/.+\/original$/),
      'upload-1',
    );
    expect(repository.save).toHaveBeenCalledTimes(1);
  });
});
