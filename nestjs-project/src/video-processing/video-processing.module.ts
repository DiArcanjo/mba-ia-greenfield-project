import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { StorageModule } from '../storage/storage.module';
import { VideosModule } from '../videos/videos.module';
import { VideoProcessingService } from './video-processing.service';

@Module({
  imports: [VideosModule, StorageModule, MediaModule],
  providers: [VideoProcessingService],
  exports: [VideoProcessingService],
})
export class VideoProcessingModule {}
