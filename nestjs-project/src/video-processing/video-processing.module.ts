import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { StorageModule } from '../storage/storage.module';
import { VIDEO_PROCESSING_QUEUE } from '../videos/video-processing.constants';
import { VideosModule } from '../videos/videos.module';
import { VideoProcessingProcessor } from './video-processing.processor';
import { VideoProcessingService } from './video-processing.service';

@Module({
  imports: [
    VideosModule,
    StorageModule,
    MediaModule,
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
  ],
  providers: [VideoProcessingService, VideoProcessingProcessor],
  exports: [VideoProcessingService],
})
export class VideoProcessingModule {}
