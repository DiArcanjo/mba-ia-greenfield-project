import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { VIDEO_PROCESSING_QUEUE } from '../videos/video-processing.constants';
import type { ProcessVideoJobData } from '../videos/video-processing.producer';
import { VideoProcessingService } from './video-processing.service';

@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(private readonly videoProcessingService: VideoProcessingService) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    await this.videoProcessingService.process(job.data.videoId);
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ProcessVideoJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    const exhausted = job.attemptsMade >= attempts;
    if (!(error instanceof UnrecoverableError) && !exhausted) {
      this.logger.warn(
        `Video ${job.data.videoId} attempt ${job.attemptsMade}/${attempts} failed: ${error.message}`,
      );
      return;
    }

    // Background task: there is no caller to propagate to, so the failure is
    // recorded on the video and logged instead of rethrown.
    try {
      await this.videoProcessingService.failPermanently(
        job.data.videoId,
        error.message,
      );
      this.logger.error(
        `Video ${job.data.videoId} failed permanently: ${error.message}`,
      );
    } catch (err) {
      this.logger.error(
        `Could not mark video ${job.data.videoId} as failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
