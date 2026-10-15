import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { QueueModule } from '../queue/queue.module';
import { UsersModule } from '../users/users.module';
import { VideoProcessingModule } from '../video-processing/video-processing.module';

/** Root module of the video worker process: no HTTP controllers. */
@Module({
  // UsersModule registers the User entity, which Channel (reached through
  // VideosModule) relates to; TypeORM needs the whole entity graph to boot.
  imports: [CoreModule, QueueModule, UsersModule, VideoProcessingModule],
})
export class WorkerModule {}
