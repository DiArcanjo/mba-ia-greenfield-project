import type { Video } from '../entities/video.entity';
import { ProcessingStatus, PublicationStatus } from '../video.types';
import { VideoResponseDto } from './video-response.dto';

function buildVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'internal-uuid',
    public_id: 'abcDEF12345',
    title: 'My video',
    original_filename: 'my-video.mp4',
    upload_id: 'secret-upload-id',
    storage_key: 'videos/internal-uuid/original',
    processing_status: ProcessingStatus.READY,
    publication_status: PublicationStatus.DRAFT,
    failure_reason: null,
    size_bytes: 2048,
    duration_seconds: 12.5,
    width: 1280,
    height: 720,
    video_codec: 'h264',
    format_name: 'mov,mp4',
    thumbnail_key: 'videos/internal-uuid/thumbnail.jpg',
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Video;
}

describe('VideoResponseDto.from', () => {
  it('should map snake_case entity fields to the camelCase response', () => {
    const dto = VideoResponseDto.from(buildVideo());

    expect(dto).toEqual({
      publicId: 'abcDEF12345',
      title: 'My video',
      processingStatus: 'ready',
      publicationStatus: 'draft',
      failureReason: null,
      sizeBytes: 2048,
      durationSeconds: 12.5,
      width: 1280,
      height: 720,
      videoCodec: 'h264',
      formatName: 'mov,mp4',
      hasThumbnail: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
  });

  it('should set hasThumbnail to false when there is no thumbnail_key', () => {
    const dto = VideoResponseDto.from(buildVideo({ thumbnail_key: null }));

    expect(dto.hasThumbnail).toBe(false);
  });

  it('should never expose the internal id, upload id or storage keys', () => {
    const json = JSON.parse(
      JSON.stringify(VideoResponseDto.from(buildVideo())),
    ) as Record<string, unknown>;

    expect(json).not.toHaveProperty('id');
    expect(json).not.toHaveProperty('uploadId');
    expect(json).not.toHaveProperty('upload_id');
    expect(json).not.toHaveProperty('storageKey');
    expect(json).not.toHaveProperty('thumbnailKey');
  });
});
