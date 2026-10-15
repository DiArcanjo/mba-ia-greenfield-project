import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Generates a valid 2s 320x240 H.264 MP4 with ffmpeg's lavfi test source.
 * `paddingBytes` appends an MP4 `free` box (ignored by every demuxer), so the
 * file stays a valid video while being large enough to span several parts.
 */
export async function generateTestVideo(paddingBytes = 0): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'test-video-'));
  const file = join(dir, 'test.mp4');
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'ffmpeg',
        [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc=duration=2:size=320x240:rate=15',
          '-pix_fmt',
          'yuv420p',
          '-y',
          file,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let stderr = '';
      child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`ffmpeg exited with ${code}: ${stderr}`)),
      );
    });
    const video = await readFile(file);
    if (paddingBytes <= 0) return video;
    const free = Buffer.alloc(paddingBytes);
    free.writeUInt32BE(paddingBytes, 0);
    free.write('free', 4, 'ascii');
    return Buffer.concat([video, free]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
