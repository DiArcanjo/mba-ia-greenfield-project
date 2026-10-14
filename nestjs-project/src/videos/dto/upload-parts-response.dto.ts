import type { ProcessingStatus } from '../video.types';

export class PresignedPartDto {
  partNumber: number;
  /** Presigned PUT URL for this part. */
  url: string;
}

export class PresignedPartsResponseDto {
  parts: PresignedPartDto[];
}

export class UploadedPartDto {
  partNumber: number;
  size: number;
  etag: string;
}

export class UploadedPartsResponseDto {
  processingStatus: ProcessingStatus;
  partSize: number;
  partCount: number;
  parts: UploadedPartDto[];
}

export class UploadAcceptedResponseDto {
  publicId: string;
  processingStatus: ProcessingStatus;
}
