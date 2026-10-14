import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { PresignPartsDto } from './dto/presign-parts.dto';
import {
  PresignedPartsResponseDto,
  UploadedPartsResponseDto,
} from './dto/upload-parts-response.dto';
import { UploadSessionResponseDto } from './dto/upload-session-response.dto';
import { VideoUploadsService } from './video-uploads.service';

@ApiTags('videos')
@Controller('videos')
export class VideoUploadsController {
  constructor(private readonly videoUploadsService: VideoUploadsService) {}

  @Post()
  @HttpCode(201)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Start a video upload',
    description:
      'Creates the video as a draft in the callers channel and opens an S3 multipart upload. The client then uploads each part directly to storage through presigned URLs.',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft created and multipart session opened',
    type: UploadSessionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Authenticated user has no channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 413,
    description: 'Declared size exceeds the maximum allowed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  initiate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateUploadDto,
  ): Promise<UploadSessionResponseDto> {
    return this.videoUploadsService.initiate(user.sub, dto);
  }

  @Post(':publicId/upload/parts')
  @HttpCode(200)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Presign upload parts',
    description:
      'Returns presigned PUT URLs for the requested parts of the multipart upload. The client uploads each part directly to storage and keeps the ETag response header of each one.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned URLs, one per requested part',
    type: PresignedPartsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or a part number exceeds the part count',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or owned by another user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in the uploading state',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  presignParts(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: PresignPartsDto,
  ): Promise<PresignedPartsResponseDto> {
    return this.videoUploadsService.presignParts(
      user.sub,
      publicId,
      dto.partNumbers,
    );
  }

  @Get(':publicId/upload')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List uploaded parts',
    description:
      'Returns the parts the storage has already received so an interrupted upload can be resumed.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload session state and the parts already received',
    type: UploadedPartsResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or owned by another user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in the uploading state',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  listUploadedParts(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<UploadedPartsResponseDto> {
    return this.videoUploadsService.listUploadedParts(user.sub, publicId);
  }
}
