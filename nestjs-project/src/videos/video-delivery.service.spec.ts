import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
import type { Video } from './entities/video.entity';
import { VideoDeliveryService } from './video-delivery.service';
import { ProcessingStatus } from './video.types';
import { VideosService } from './videos.service';

describe('VideoDeliveryService', () => {
  let service: VideoDeliveryService;
  const videosService = { findOwnedByPublicId: jest.fn() };
  const storage = { presignGetObject: jest.fn() };

  const video = (overrides: Partial<Video> = {}): Video =>
    ({
      storage_key: 'videos/1/original',
      original_filename: 'aula.mp4',
      thumbnail_key: 'videos/1/thumbnail.jpg',
      processing_status: ProcessingStatus.READY,
      ...overrides,
    }) as Video;

  beforeEach(async () => {
    jest.resetAllMocks();
    storage.presignGetObject.mockResolvedValue('https://signed');
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [videoConfig] })],
      providers: [
        VideoDeliveryService,
        { provide: VideosService, useValue: videosService },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(VideoDeliveryService);
  });

  it('should presign the original object for a ready video without a download filename', async () => {
    videosService.findOwnedByPublicId.mockResolvedValue(video());

    await expect(service.getStreamUrl('u', 'pub')).resolves.toBe(
      'https://signed',
    );
    expect(storage.presignGetObject).toHaveBeenCalledWith('videos/1/original', {
      expiresIn: 10800,
    });
  });

  it('should pass the original filename only for downloads', async () => {
    videosService.findOwnedByPublicId.mockResolvedValue(video());

    await service.getDownloadUrl('u', 'pub');

    expect(storage.presignGetObject).toHaveBeenCalledWith('videos/1/original', {
      expiresIn: 10800,
      downloadFilename: 'aula.mp4',
    });
  });

  it('should presign the thumbnail key', async () => {
    videosService.findOwnedByPublicId.mockResolvedValue(video());

    await service.getThumbnailUrl('u', 'pub');

    expect(storage.presignGetObject).toHaveBeenCalledWith(
      'videos/1/thumbnail.jpg',
      { expiresIn: 10800 },
    );
  });

  it.each([
    ProcessingStatus.UPLOADING,
    ProcessingStatus.PROCESSING,
    ProcessingStatus.FAILED,
  ])('should reject stream and download when status is %s', async (status) => {
    videosService.findOwnedByPublicId.mockResolvedValue(
      video({ processing_status: status }),
    );

    await expect(service.getStreamUrl('u', 'pub')).rejects.toBeInstanceOf(
      VideoNotReadyException,
    );
    await expect(service.getDownloadUrl('u', 'pub')).rejects.toBeInstanceOf(
      VideoNotReadyException,
    );
  });

  it('should reject the thumbnail when there is no thumbnail_key', async () => {
    videosService.findOwnedByPublicId.mockResolvedValue(
      video({ thumbnail_key: null }),
    );

    await expect(service.getThumbnailUrl('u', 'pub')).rejects.toBeInstanceOf(
      VideoNotReadyException,
    );
  });

  it('should propagate VideoNotFoundException for videos of other users', async () => {
    videosService.findOwnedByPublicId.mockRejectedValue(
      new VideoNotFoundException(),
    );

    for (const call of [
      () => service.getStreamUrl('u', 'pub'),
      () => service.getDownloadUrl('u', 'pub'),
      () => service.getThumbnailUrl('u', 'pub'),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(VideoNotFoundException);
    }
  });
});
