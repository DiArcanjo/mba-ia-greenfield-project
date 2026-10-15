import { Test } from '@nestjs/testing';
import { MediaToolsService } from './media-tools.service';
import { MediaModule } from './media.module';

describe('MediaModule', () => {
  it('should compile and expose MediaToolsService', async () => {
    const module = await Test.createTestingModule({
      imports: [MediaModule],
    }).compile();

    expect(module.get(MediaToolsService)).toBeInstanceOf(MediaToolsService);
  });
});
