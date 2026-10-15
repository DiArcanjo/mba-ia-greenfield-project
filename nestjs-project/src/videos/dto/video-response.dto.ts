import { ApiProperty } from '@nestjs/swagger';
import type { Video } from '../entities/video.entity';
import { ProcessingStatus, PublicationStatus } from '../video.types';

export class VideoResponseDto {
  @ApiProperty({ example: 'aB3_xYz-k9Q', description: '11-character URL id' })
  publicId: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: ProcessingStatus, enumName: 'ProcessingStatus' })
  processingStatus: ProcessingStatus;

  @ApiProperty({ enum: PublicationStatus, enumName: 'PublicationStatus' })
  publicationStatus: PublicationStatus;

  @ApiProperty({ type: String, nullable: true })
  failureReason: string | null;

  @ApiProperty({ type: 'integer', description: 'Original file size in bytes' })
  sizeBytes: number;

  @ApiProperty({ type: Number, nullable: true })
  durationSeconds: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  width: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  height: number | null;

  @ApiProperty({ type: String, nullable: true })
  videoCodec: string | null;

  @ApiProperty({ type: String, nullable: true })
  formatName: string | null;

  @ApiProperty()
  hasThumbnail: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
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
