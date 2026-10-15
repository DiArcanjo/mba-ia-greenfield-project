import { ApiProperty } from '@nestjs/swagger';
import { ProcessingStatus } from '../video.types';

export class PresignedPartDto {
  @ApiProperty({ type: 'integer' })
  partNumber: number;

  @ApiProperty({ description: 'Presigned PUT URL for this part' })
  url: string;
}

export class PresignedPartsResponseDto {
  @ApiProperty({ type: () => [PresignedPartDto] })
  parts: PresignedPartDto[];
}

export class UploadedPartDto {
  @ApiProperty({ type: 'integer' })
  partNumber: number;

  @ApiProperty({ type: 'integer', description: 'Part size in bytes' })
  size: number;

  @ApiProperty({ description: 'ETag returned by the storage for this part' })
  etag: string;
}

export class UploadedPartsResponseDto {
  @ApiProperty({ enum: ProcessingStatus, enumName: 'ProcessingStatus' })
  processingStatus: ProcessingStatus;

  @ApiProperty({ type: 'integer' })
  partSize: number;

  @ApiProperty({ type: 'integer' })
  partCount: number;

  @ApiProperty({ type: () => [UploadedPartDto] })
  parts: UploadedPartDto[];
}

export class UploadAcceptedResponseDto {
  @ApiProperty({ example: 'aB3_xYz-k9Q' })
  publicId: string;

  @ApiProperty({ enum: ProcessingStatus, enumName: 'ProcessingStatus' })
  processingStatus: ProcessingStatus;
}
