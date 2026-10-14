import type { Video } from '../entities/video.entity';
import type { ProcessingStatus, PublicationStatus } from '../video.types';

export class VideoResponseDto {
  publicId: string;
  title: string;
  processingStatus: ProcessingStatus;
  publicationStatus: PublicationStatus;
  failureReason: string | null;
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  formatName: string | null;
  hasThumbnail: boolean;
  createdAt: Date;

  static from(video: Video): VideoResponseDto {
    const dto = new VideoResponseDto();
    dto.publicId = video.public_id;
    dto.title = video.title;
    dto.processingStatus = video.processing_status;
    dto.publicationStatus = video.publication_status;
    dto.failureReason = video.failure_reason;
    dto.sizeBytes = video.size_bytes;
    dto.durationSeconds = video.duration_seconds;
    dto.width = video.width;
    dto.height = video.height;
    dto.videoCodec = video.video_codec;
    dto.formatName = video.format_name;
    dto.hasThumbnail = video.thumbnail_key !== null;
    dto.createdAt = video.created_at;
    return dto;
  }
}
