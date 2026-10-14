import type { ProcessingStatus, PublicationStatus } from '../video.types';

export class UploadSessionDto {
  uploadId: string;
  /** Bytes per part (the last part may be smaller). */
  partSize: number;
  partCount: number;
}

export class UploadSessionResponseDto {
  publicId: string;
  title: string;
  processingStatus: ProcessingStatus;
  publicationStatus: PublicationStatus;
  upload: UploadSessionDto;
}
