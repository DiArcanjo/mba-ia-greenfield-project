import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { VideoNotFoundException } from '../common/exceptions/domain.exception';
import { Video } from './entities/video.entity';
import { ProcessingStatus } from './video.types';

const FAILURE_REASON_MAX_LENGTH = 500;

export interface VideoMetadata {
  durationSeconds: number;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  formatName: string | null;
  thumbnailKey: string | null;
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
  ) {}

  async findOwnedByPublicId(publicId: string, userId: string): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId, channel: { user_id: userId } },
    });
    if (!video) throw new VideoNotFoundException();
    return video;
  }

  async findById(id: string): Promise<Video | null> {
    return this.videoRepository.findOne({ where: { id } });
  }

  async markProcessing(id: string): Promise<boolean> {
    const result = await this.videoRepository.update(
      { id, processing_status: ProcessingStatus.UPLOADING },
      { processing_status: ProcessingStatus.PROCESSING, upload_id: null },
    );
    return (result.affected ?? 0) > 0;
  }

  async markReady(id: string, metadata: VideoMetadata): Promise<boolean> {
    const result = await this.videoRepository.update(
      { id, processing_status: ProcessingStatus.PROCESSING },
      {
        processing_status: ProcessingStatus.READY,
        duration_seconds: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        video_codec: metadata.videoCodec,
        format_name: metadata.formatName,
        thumbnail_key: metadata.thumbnailKey,
        failure_reason: null,
      },
    );
    return (result.affected ?? 0) > 0;
  }

  async markFailed(id: string, reason: string): Promise<boolean> {
    const result = await this.videoRepository.update(
      {
        id,
        processing_status: In([
          ProcessingStatus.UPLOADING,
          ProcessingStatus.PROCESSING,
        ]),
      },
      {
        processing_status: ProcessingStatus.FAILED,
        failure_reason: reason.slice(0, FAILURE_REASON_MAX_LENGTH),
      },
    );
    return (result.affected ?? 0) > 0;
  }
}
