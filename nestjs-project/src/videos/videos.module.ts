import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import { StorageModule } from '../storage/storage.module';
import { Video } from './entities/video.entity';
import { VIDEO_PROCESSING_QUEUE } from './video-processing.constants';
import { VideoUploadsController } from './video-uploads.controller';
import { VideoDeliveryService } from './video-delivery.service';
import { VideoProcessingProducer } from './video-processing.producer';
import { VideoUploadsService } from './video-uploads.service';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [
    ChannelsModule,
    StorageModule,
    TypeOrmModule.forFeature([Video]),
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
  ],
  controllers: [VideoUploadsController, VideosController],
  providers: [
    VideoDeliveryService,
    VideoProcessingProducer,
    VideoUploadsService,
    VideosService,
  ],
  exports: [TypeOrmModule, VideoProcessingProducer, VideosService],
})
export class VideosModule {}
