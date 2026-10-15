import { Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { MediaToolsService } from '../media/media-tools.service';
import { MediaProcessingError } from '../media/media.types';
import { STORAGE_KEYS } from '../storage/storage.constants';
import { StorageService } from '../storage/storage.service';
import { ProcessingStatus } from '../videos/video.types';
import { VideosService } from '../videos/videos.service';

const SOURCE_URL_TTL_SECONDS = 3600;
const MAX_THUMBNAIL_OFFSET_SECONDS = 1;

@Injectable()
export class VideoProcessingService {
  constructor(
    private readonly videosService: VideosService,
    private readonly storageService: StorageService,
    private readonly mediaTools: MediaToolsService,
  ) {}

  async process(videoId: string): Promise<void> {
    const video = await this.videosService.findById(videoId);
    // At-least-once delivery: anything but `processing` was already handled.
    if (!video || video.processing_status !== ProcessingStatus.PROCESSING) {
      return;
    }

    try {
      const url = await this.storageService.presignGetObject(
        video.storage_key,
        { expiresIn: SOURCE_URL_TTL_SECONDS },
      );
      const metadata = await this.mediaTools.probe(url);
      const thumbnail = await this.mediaTools.extractThumbnail(
        url,
        Math.min(MAX_THUMBNAIL_OFFSET_SECONDS, metadata.durationSeconds / 2),
      );

      const thumbnailKey = STORAGE_KEYS.videoThumbnail(video.id);
      await this.storageService.putObject(
        thumbnailKey,
        thumbnail,
        'image/jpeg',
      );
      await this.videosService.markReady(video.id, {
        ...metadata,
        thumbnailKey,
      });
    } catch (err) {
      if (err instanceof MediaProcessingError && !err.retryable) {
        throw new UnrecoverableError(err.message);
      }
      throw err;
    }
  }

  async failPermanently(videoId: string, reason: string): Promise<void> {
    await this.videosService.markFailed(videoId, reason);
  }
}
