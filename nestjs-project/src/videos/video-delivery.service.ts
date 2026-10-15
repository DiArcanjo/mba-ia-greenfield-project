import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { VideoNotReadyException } from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
import type { Video } from './entities/video.entity';
import { ProcessingStatus } from './video.types';
import { VideosService } from './videos.service';

@Injectable()
export class VideoDeliveryService {
  constructor(
    private readonly videosService: VideosService,
    private readonly storageService: StorageService,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  async getStreamUrl(userId: string, publicId: string): Promise<string> {
    const video = await this.findReadyVideo(userId, publicId);
    return this.storageService.presignGetObject(video.storage_key, {
      expiresIn: this.config.streamUrlTtlSeconds,
    });
  }

  async getDownloadUrl(userId: string, publicId: string): Promise<string> {
    const video = await this.findReadyVideo(userId, publicId);
    return this.storageService.presignGetObject(video.storage_key, {
      expiresIn: this.config.streamUrlTtlSeconds,
      downloadFilename: video.original_filename,
    });
  }

  async getThumbnailUrl(userId: string, publicId: string): Promise<string> {
    const video = await this.videosService.findOwnedByPublicId(
      publicId,
      userId,
    );
    if (!video.thumbnail_key) throw new VideoNotReadyException();
    return this.storageService.presignGetObject(video.thumbnail_key, {
      expiresIn: this.config.streamUrlTtlSeconds,
    });
  }

  private async findReadyVideo(
    userId: string,
    publicId: string,
  ): Promise<Video> {
    const video = await this.videosService.findOwnedByPublicId(
      publicId,
      userId,
    );
    if (video.processing_status !== ProcessingStatus.READY) {
      throw new VideoNotReadyException();
    }
    return video;
  }
}
