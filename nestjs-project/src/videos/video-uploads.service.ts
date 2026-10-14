import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
  InvalidUploadPartsException,
  InvalidUploadStateException,
  UploadSizeMismatchException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import { STORAGE_KEYS } from '../storage/storage.constants';
import { StorageService } from '../storage/storage.service';
import type { CompletedPartDto } from './dto/complete-upload.dto';
import type { InitiateUploadDto } from './dto/initiate-upload.dto';
import type {
  PresignedPartsResponseDto,
  UploadAcceptedResponseDto,
  UploadedPartsResponseDto,
} from './dto/upload-parts-response.dto';
import type { UploadSessionResponseDto } from './dto/upload-session-response.dto';
import { Video } from './entities/video.entity';
import { generatePublicId } from './public-id.util';
import { VideoProcessingProducer } from './video-processing.producer';
import { ProcessingStatus, PublicationStatus } from './video.types';
import { VideosService } from './videos.service';

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

function isNoSuchUpload(err: unknown): boolean {
  return err instanceof Error && err.name === 'NoSuchUpload';
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
    private readonly videosService: VideosService,
    private readonly producer: VideoProcessingProducer,
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

  async presignParts(
    userId: string,
    publicId: string,
    partNumbers: number[],
  ): Promise<PresignedPartsResponseDto> {
    const video = await this.findUploadingVideo(userId, publicId);
    const partCount = this.partCountOf(video);
    if (partNumbers.some((n) => n < 1 || n > partCount)) {
      throw new InvalidUploadPartsException();
    }

    const parts = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.storageService.presignUploadPart(
          video.storage_key,
          video.upload_id as string,
          partNumber,
          this.config.partUrlTtlSeconds,
        ),
      })),
    );
    return { parts };
  }

  async listUploadedParts(
    userId: string,
    publicId: string,
  ): Promise<UploadedPartsResponseDto> {
    const video = await this.findUploadingVideo(userId, publicId);
    const uploaded = await this.storageService.listParts(
      video.storage_key,
      video.upload_id as string,
    );
    return {
      processingStatus: video.processing_status,
      partSize: video.part_size_bytes,
      partCount: this.partCountOf(video),
      parts: uploaded.map(({ partNumber, size, etag }) => ({
        partNumber,
        size,
        etag,
      })),
    };
  }

  async complete(
    userId: string,
    publicId: string,
    parts: CompletedPartDto[],
  ): Promise<UploadAcceptedResponseDto> {
    const video = await this.videosService.findOwnedByPublicId(
      publicId,
      userId,
    );

    if (video.processing_status === ProcessingStatus.FAILED) {
      throw new InvalidUploadStateException();
    }
    if (video.processing_status !== ProcessingStatus.UPLOADING) {
      return this.acceptedFor(video);
    }

    const partCount = this.partCountOf(video);
    const numbers = parts.map((p) => p.partNumber).sort((a, b) => a - b);
    if (
      numbers.length !== partCount ||
      numbers.some((n, index) => n !== index + 1)
    ) {
      throw new InvalidUploadPartsException();
    }

    try {
      await this.storageService.completeMultipartUpload(
        video.storage_key,
        video.upload_id as string,
        parts,
      );
    } catch (err) {
      if (!isNoSuchUpload(err)) throw err;
      // A concurrent request may have already completed this upload.
      const current = await this.videosService.findOwnedByPublicId(
        publicId,
        userId,
      );
      if (current.processing_status === ProcessingStatus.UPLOADING) throw err;
      return this.acceptedFor(current);
    }

    const head = await this.storageService.headObject(video.storage_key);
    if (head.contentLength !== video.size_bytes) {
      await this.storageService.deleteObject(video.storage_key);
      await this.videosService.markFailed(video.id, 'upload size mismatch');
      throw new UploadSizeMismatchException();
    }

    await this.videosService.markProcessing(video.id);
    await this.producer.enqueue(video.id);
    return {
      publicId: video.public_id,
      processingStatus: ProcessingStatus.PROCESSING,
    };
  }

  private async acceptedFor(video: Video): Promise<UploadAcceptedResponseDto> {
    if (video.processing_status === ProcessingStatus.PROCESSING) {
      await this.producer.enqueue(video.id);
    }
    return {
      publicId: video.public_id,
      processingStatus: video.processing_status,
    };
  }

  private async findUploadingVideo(
    userId: string,
    publicId: string,
  ): Promise<Video> {
    const video = await this.videosService.findOwnedByPublicId(
      publicId,
      userId,
    );
    if (video.processing_status !== ProcessingStatus.UPLOADING) {
      throw new InvalidUploadStateException();
    }
    return video;
  }

  private partCountOf(video: Video): number {
    return Math.ceil(video.size_bytes / video.part_size_bytes);
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
