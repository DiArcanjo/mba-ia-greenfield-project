import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VideoNotFoundException } from '../common/exceptions/domain.exception';
import { Video } from './entities/video.entity';
import { VideosService } from './videos.service';

describe('VideosService', () => {
  let service: VideosService;
  const repository = { findOne: jest.fn(), update: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: repository },
      ],
    }).compile();
    service = module.get(VideosService);
  });

  describe('findOwnedByPublicId', () => {
    it('should return the video when it belongs to the user', async () => {
      const video = { id: 'v1' } as Video;
      repository.findOne.mockResolvedValue(video);

      await expect(service.findOwnedByPublicId('pub', 'user')).resolves.toBe(
        video,
      );
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { public_id: 'pub', channel: { user_id: 'user' } },
      });
    });

    it('should throw VideoNotFoundException when no video matches', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.findOwnedByPublicId('pub', 'user'),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });
  });

  describe('transitions', () => {
    const metadata = {
      durationSeconds: 1,
      width: 1,
      height: 1,
      videoCodec: 'h264',
      formatName: 'mp4',
      thumbnailKey: 'k',
    };

    it.each([
      ['markProcessing', (id: string) => service.markProcessing(id)],
      ['markReady', (id: string) => service.markReady(id, metadata)],
      ['markFailed', (id: string) => service.markFailed(id, 'boom')],
    ])('%s should return true when a row was updated', async (_name, run) => {
      repository.update.mockResolvedValue({ affected: 1 });

      await expect(run('v1')).resolves.toBe(true);
    });

    it.each([
      ['markProcessing', (id: string) => service.markProcessing(id)],
      ['markReady', (id: string) => service.markReady(id, metadata)],
      ['markFailed', (id: string) => service.markFailed(id, 'boom')],
    ])('%s should return false when no row matched', async (_name, run) => {
      repository.update.mockResolvedValue({ affected: 0 });

      await expect(run('v1')).resolves.toBe(false);
    });
  });
});
