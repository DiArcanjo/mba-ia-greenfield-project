import { Body, Controller, HttpCode, Post } from '@nestjs/common';
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
}
