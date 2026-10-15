import { Test } from '@nestjs/testing';
import { UnrecoverableError } from 'bullmq';
import { MediaToolsService } from '../media/media-tools.service';
import { MediaProcessingError } from '../media/media.types';
import { StorageService } from '../storage/storage.service';
import type { Video } from '../videos/entities/video.entity';
import { ProcessingStatus } from '../videos/video.types';
import { VideosService } from '../videos/videos.service';
import { VideoProcessingService } from './video-processing.service';

describe('VideoProcessingService', () => {
  let service: VideoProcessingService;
  const videosService = {
    findById: jest.fn(),
    markReady: jest.fn(),
    markFailed: jest.fn(),
  };
  const storage = { presignGetObject: jest.fn(), putObject: jest.fn() };
  const media = { probe: jest.fn(), extractThumbnail: jest.fn() };

  const processingVideo = (status = ProcessingStatus.PROCESSING): Video =>
    ({
      id: 'vid-1',
      storage_key: 'videos/vid-1/original',
      processing_status: status,
    }) as Video;

  beforeEach(async () => {
    jest.resetAllMocks();
    storage.presignGetObject.mockResolvedValue('https://signed');
    media.probe.mockResolvedValue({
      durationSeconds: 2,
      width: 320,
      height: 240,
      videoCodec: 'h264',
      formatName: 'mov,mp4',
    });
    media.extractThumbnail.mockResolvedValue(Buffer.from([0xff, 0xd8]));
    const module = await Test.createTestingModule({
      providers: [
        VideoProcessingService,
        { provide: VideosService, useValue: videosService },
        { provide: StorageService, useValue: storage },
        { provide: MediaToolsService, useValue: media },
      ],
    }).compile();
    service = module.get(VideoProcessingService);
  });

  it.each([
    ['missing', null],
    ['ready', processingVideo(ProcessingStatus.READY)],
    ['failed', processingVideo(ProcessingStatus.FAILED)],
    ['uploading', processingVideo(ProcessingStatus.UPLOADING)],
  ])('should do nothing for a %s video', async (_name, video) => {
    videosService.findById.mockResolvedValue(video);

    await service.process('vid-1');

    expect(media.probe).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(videosService.markReady).not.toHaveBeenCalled();
  });

  it('should probe, store the thumbnail and mark the video ready', async () => {
    videosService.findById.mockResolvedValue(processingVideo());

    await service.process('vid-1');

    expect(media.extractThumbnail).toHaveBeenCalledWith('https://signed', 1);
    expect(storage.putObject).toHaveBeenCalledWith(
      'videos/vid-1/thumbnail.jpg',
      expect.any(Buffer),
      'image/jpeg',
    );
    expect(videosService.markReady).toHaveBeenCalledWith('vid-1', {
      durationSeconds: 2,
      width: 320,
      height: 240,
      videoCodec: 'h264',
      formatName: 'mov,mp4',
      thumbnailKey: 'videos/vid-1/thumbnail.jpg',
    });
  });

  it('should extract the thumbnail at half the duration for very short videos', async () => {
    videosService.findById.mockResolvedValue(processingVideo());
    media.probe.mockResolvedValue({
      durationSeconds: 0.5,
      width: 1,
      height: 1,
      videoCodec: 'h264',
      formatName: 'mp4',
    });

    await service.process('vid-1');

    expect(media.extractThumbnail).toHaveBeenCalledWith('https://signed', 0.25);
  });

  it('should convert a non-retryable media error into UnrecoverableError', async () => {
    videosService.findById.mockResolvedValue(processingVideo());
    media.probe.mockRejectedValue(
      new MediaProcessingError('not a video', false),
    );

    await expect(service.process('vid-1')).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(videosService.markReady).not.toHaveBeenCalled();
  });

  it('should propagate a retryable media error unchanged', async () => {
    videosService.findById.mockResolvedValue(processingVideo());
    const error = new MediaProcessingError('network', true);
    media.probe.mockRejectedValue(error);

    await expect(service.process('vid-1')).rejects.toBe(error);
  });

  it('should delegate failPermanently to markFailed', async () => {
    await service.failPermanently('vid-1', 'boom');

    expect(videosService.markFailed).toHaveBeenCalledWith('vid-1', 'boom');
  });
});
