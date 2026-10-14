import { Test } from '@nestjs/testing';
import { VideoProcessingProcessor } from '../video-processing/video-processing.processor';
import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  const originalPrefix = process.env.QUEUE_PREFIX;

  beforeAll(() => {
    // A throwaway prefix keeps this process from consuming the real queue.
    process.env.QUEUE_PREFIX = `test-${Date.now()}-${process.pid}`;
  });

  afterAll(() => {
    if (originalPrefix === undefined) delete process.env.QUEUE_PREFIX;
    else process.env.QUEUE_PREFIX = originalPrefix;
  });

  it('should compile with the processor and without HTTP controllers', async () => {
    const module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    expect(module.get(VideoProcessingProcessor)).toBeInstanceOf(
      VideoProcessingProcessor,
    );
    expect(Reflect.getMetadata('controllers', WorkerModule)).toBeUndefined();
    await module.close();
  }, 30000);
});
