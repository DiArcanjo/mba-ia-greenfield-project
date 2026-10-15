import { ApiProperty } from '@nestjs/swagger';
import { ProcessingStatus, PublicationStatus } from '../video.types';

export class UploadSessionDto {
  @ApiProperty({ description: 'S3 multipart upload id' })
  uploadId: string;

  @ApiProperty({
    type: 'integer',
    description: 'Bytes per part (the last part may be smaller)',
  })
  partSize: number;

  @ApiProperty({ type: 'integer', description: 'ceil(size / partSize)' })
  partCount: number;
}

export class UploadSessionResponseDto {
  @ApiProperty({ example: 'aB3_xYz-k9Q', description: '11-character URL id' })
  publicId: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: ProcessingStatus, enumName: 'ProcessingStatus' })
  processingStatus: ProcessingStatus;

  @ApiProperty({ enum: PublicationStatus, enumName: 'PublicationStatus' })
  publicationStatus: PublicationStatus;

  @ApiProperty({ type: () => UploadSessionDto })
  upload: UploadSessionDto;
}
