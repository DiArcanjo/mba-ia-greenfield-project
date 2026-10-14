import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import { STORAGE_KEYS } from '../storage/storage.constants';
import { StorageService } from '../storage/storage.service';
import type { InitiateUploadDto } from './dto/initiate-upload.dto';
import type { UploadSessionResponseDto } from './dto/upload-session-response.dto';
import { Video } from './entities/video.entity';
import { generatePublicId } from './public-id.util';
import { ProcessingStatus, PublicationStatus } from './video.types';

const PG_UNIQUE_VIOLATION = '23505';
const PUBLIC_ID_COLUMN = 'public_id';
const MAX_PUBLIC_ID_ATTEMPTS = 5;
const TITLE_MAX_LENGTH = 255;

function isPublicIdCollision(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const e = err as QueryFailedError & { code?: unknown; detail?: unknown };
  return (
    e.code === PG_UNIQUE_VIOLATION &&
    typeof e.detail === 'string' &&
    e.detail.includes(PUBLIC_ID_COLUMN)
  );
}

function titleFromFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return base.slice(0, TITLE_MAX_LENGTH);
}

@Injectable()
export class VideoUploadsService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  async initiate(
    userId: string,
    dto: InitiateUploadDto,
  ): Promise<UploadSessionResponseDto> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) throw new ChannelNotFoundException();
    if (dto.size > this.config.maxSizeBytes) throw new VideoTooLargeException();

    const id = randomUUID();
    const storageKey = STORAGE_KEYS.videoOriginal(id);
    const partSize = this.config.partSizeBytes;
    const partCount = Math.ceil(dto.size / partSize);

    const uploadId = await this.storageService.createMultipartUpload(
      storageKey,
      dto.contentType,
    );

    let video: Video;
    try {
      video = await this.insertWithUniquePublicId({
        id,
        channel_id: channel.id,
        title: titleFromFilename(dto.filename),
        original_filename: dto.filename,
        content_type: dto.contentType,
        size_bytes: dto.size,
        storage_key: storageKey,
        upload_id: uploadId,
        part_size_bytes: partSize,
        processing_status: ProcessingStatus.UPLOADING,
        publication_status: PublicationStatus.DRAFT,
      });
    } catch (err) {
      await this.storageService.abortMultipartUpload(storageKey, uploadId);
      throw err;
    }

    return {
      publicId: video.public_id,
      title: video.title,
      processingStatus: video.processing_status,
      publicationStatus: video.publication_status,
      upload: { uploadId, partSize, partCount },
    };
  }

  private async insertWithUniquePublicId(data: Partial<Video>): Promise<Video> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.videoRepository.save(
          this.videoRepository.create({
            ...data,
            public_id: generatePublicId(),
          }),
        );
      } catch (err) {
        if (!isPublicIdCollision(err) || attempt >= MAX_PUBLIC_ID_ATTEMPTS) {
          throw err;
        }
      }
    }
  }
}
