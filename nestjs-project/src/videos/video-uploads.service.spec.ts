import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
  InvalidUploadPartsException,
  InvalidUploadStateException,
  UploadSizeMismatchException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
import { Video } from './entities/video.entity';
import { PUBLIC_ID_PATTERN } from './public-id.util';
import { VideoProcessingProducer } from './video-processing.producer';
import { VideoUploadsService } from './video-uploads.service';
import { ProcessingStatus } from './video.types';
import { VideosService } from './videos.service';

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
    presignUploadPart: jest.fn(),
    listParts: jest.fn(),
    completeMultipartUpload: jest.fn(),
    headObject: jest.fn(),
    deleteObject: jest.fn(),
  };
  const videosService = {
    findOwnedByPublicId: jest.fn(),
    markProcessing: jest.fn(),
    markFailed: jest.fn(),
  };
  const producer = { enqueue: jest.fn() };
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
        { provide: VideosService, useValue: videosService },
        { provide: VideoProcessingProducer, useValue: producer },
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

describe('VideoUploadsService handshake', () => {
  let service: VideoUploadsService;
  const storage = {
    presignUploadPart: jest.fn(),
    listParts: jest.fn(),
    completeMultipartUpload: jest.fn(),
    headObject: jest.fn(),
    deleteObject: jest.fn(),
  };
  const videosService = {
    findOwnedByPublicId: jest.fn(),
    markProcessing: jest.fn(),
    markFailed: jest.fn(),
  };
  const producer = { enqueue: jest.fn() };

  const video = (overrides: Partial<Video> = {}): Video =>
    ({
      id: 'vid-1',
      public_id: 'pub00000001',
      storage_key: 'videos/vid-1/original',
      upload_id: 'upload-1',
      size_bytes: 12 * 1024 * 1024,
      part_size_bytes: FIVE_MIB,
      processing_status: ProcessingStatus.UPLOADING,
      ...overrides,
    }) as Video;

  const allParts = [1, 2, 3].map((partNumber) => ({
    partNumber,
    etag: `"e${partNumber}"`,
  }));

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [videoConfig] })],
      providers: [
        VideoUploadsService,
        { provide: getRepositoryToken(Video), useValue: {} },
        { provide: ChannelsService, useValue: {} },
        { provide: StorageService, useValue: storage },
        { provide: VideosService, useValue: videosService },
        { provide: VideoProcessingProducer, useValue: producer },
      ],
    }).compile();
    service = module.get(VideoUploadsService);
    videosService.findOwnedByPublicId.mockResolvedValue(video());
    storage.headObject.mockResolvedValue({ contentLength: 12 * 1024 * 1024 });
  });

  describe('presignParts', () => {
    it('should presign each requested part with the configured TTL', async () => {
      storage.presignUploadPart.mockImplementation(
        (_k: string, _u: string, n: number) => Promise.resolve(`url-${n}`),
      );

      const result = await service.presignParts('u', 'pub', [1, 3]);

      expect(result.parts).toEqual([
        { partNumber: 1, url: 'url-1' },
        { partNumber: 3, url: 'url-3' },
      ]);
      expect(storage.presignUploadPart).toHaveBeenCalledWith(
        'videos/vid-1/original',
        'upload-1',
        1,
        3600,
      );
    });

    it('should reject a partNumber above partCount', async () => {
      await expect(
        service.presignParts('u', 'pub', [4]),
      ).rejects.toBeInstanceOf(InvalidUploadPartsException);
    });

    it('should reject when the video is not uploading', async () => {
      videosService.findOwnedByPublicId.mockResolvedValue(
        video({ processing_status: ProcessingStatus.PROCESSING }),
      );

      await expect(
        service.presignParts('u', 'pub', [1]),
      ).rejects.toBeInstanceOf(InvalidUploadStateException);
    });
  });

  describe('listUploadedParts', () => {
    it('should return the uploaded parts with partSize and partCount', async () => {
      storage.listParts.mockResolvedValue([
        { partNumber: 1, etag: '"e1"', size: FIVE_MIB },
      ]);

      const result = await service.listUploadedParts('u', 'pub');

      expect(result).toEqual({
        processingStatus: 'uploading',
        partSize: FIVE_MIB,
        partCount: 3,
        parts: [{ partNumber: 1, etag: '"e1"', size: FIVE_MIB }],
      });
    });

    it('should reject when the video is not uploading', async () => {
      videosService.findOwnedByPublicId.mockResolvedValue(
        video({ processing_status: ProcessingStatus.READY }),
      );

      await expect(
        service.listUploadedParts('u', 'pub'),
      ).rejects.toBeInstanceOf(InvalidUploadStateException);
    });
  });

  describe('complete', () => {
    it('should complete, mark processing and enqueue once', async () => {
      const result = await service.complete('u', 'pub', allParts);

      expect(result).toEqual({
        publicId: 'pub00000001',
        processingStatus: 'processing',
      });
      expect(storage.completeMultipartUpload).toHaveBeenCalledWith(
        'videos/vid-1/original',
        'upload-1',
        allParts,
      );
      expect(videosService.markProcessing).toHaveBeenCalledWith('vid-1');
      expect(producer.enqueue).toHaveBeenCalledWith('vid-1');
    });

    it('should accept parts in any order', async () => {
      await expect(
        service.complete('u', 'pub', [...allParts].reverse()),
      ).resolves.toMatchObject({ processingStatus: 'processing' });
    });

    it.each([
      ['fewer parts', allParts.slice(0, 2)],
      ['a gap', [allParts[0], allParts[2], { partNumber: 5, etag: 'x' }]],
      ['duplicates', [allParts[0], allParts[0], allParts[1]]],
    ])('should reject %s', async (_name, parts) => {
      await expect(service.complete('u', 'pub', parts)).rejects.toBeInstanceOf(
        InvalidUploadPartsException,
      );
      expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    });

    it('should return the current state and re-enqueue when already processing', async () => {
      videosService.findOwnedByPublicId.mockResolvedValue(
        video({ processing_status: ProcessingStatus.PROCESSING }),
      );

      const result = await service.complete('u', 'pub', allParts);

      expect(result.processingStatus).toBe('processing');
      expect(producer.enqueue).toHaveBeenCalledWith('vid-1');
      expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    });

    it('should return ready without enqueueing when already ready', async () => {
      videosService.findOwnedByPublicId.mockResolvedValue(
        video({ processing_status: ProcessingStatus.READY }),
      );

      const result = await service.complete('u', 'pub', allParts);

      expect(result.processingStatus).toBe('ready');
      expect(producer.enqueue).not.toHaveBeenCalled();
    });

    it('should reject a failed video', async () => {
      videosService.findOwnedByPublicId.mockResolvedValue(
        video({ processing_status: ProcessingStatus.FAILED }),
      );

      await expect(
        service.complete('u', 'pub', allParts),
      ).rejects.toBeInstanceOf(InvalidUploadStateException);
    });

    it('should remove the object, mark failed and throw on a size mismatch', async () => {
      storage.headObject.mockResolvedValue({ contentLength: 10 });

      await expect(
        service.complete('u', 'pub', allParts),
      ).rejects.toBeInstanceOf(UploadSizeMismatchException);
      expect(storage.deleteObject).toHaveBeenCalledWith(
        'videos/vid-1/original',
      );
      expect(videosService.markFailed).toHaveBeenCalledWith(
        'vid-1',
        'upload size mismatch',
      );
      expect(producer.enqueue).not.toHaveBeenCalled();
    });

    it('should answer idempotently when NoSuchUpload races with a concurrent complete', async () => {
      const noSuchUpload = Object.assign(new Error('gone'), {
        name: 'NoSuchUpload',
      });
      storage.completeMultipartUpload.mockRejectedValue(noSuchUpload);
      videosService.findOwnedByPublicId
        .mockResolvedValueOnce(video())
        .mockResolvedValueOnce(
          video({ processing_status: ProcessingStatus.PROCESSING }),
        );

      const result = await service.complete('u', 'pub', allParts);

      expect(result.processingStatus).toBe('processing');
    });

    it('should rethrow NoSuchUpload when the video is still uploading', async () => {
      const noSuchUpload = Object.assign(new Error('gone'), {
        name: 'NoSuchUpload',
      });
      storage.completeMultipartUpload.mockRejectedValue(noSuchUpload);

      await expect(service.complete('u', 'pub', allParts)).rejects.toBe(
        noSuchUpload,
      );
    });
  });
});
