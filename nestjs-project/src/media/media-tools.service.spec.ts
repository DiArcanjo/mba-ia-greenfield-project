import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { MediaToolsService } from './media-tools.service';
import { MediaProcessingError } from './media.types';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));

const SIGNED_URL =
  'http://minio:9000/streamtube-videos/videos/abc/original' +
  '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=secretkey%2F20261014' +
  '&X-Amz-Signature=deadbeefcafe0123456789';

function fakeChild(stderr: string, exitCode: number) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: jest.Mock;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = jest.fn();
  setImmediate(() => {
    child.stderr.write(stderr);
    child.stdout.end();
    child.stderr.end();
    setImmediate(() => child.emit('close', exitCode));
  });
  return child;
}

describe('MediaToolsService error sanitization', () => {
  const service = new MediaToolsService();
  const spawnMock = spawn as unknown as jest.Mock;

  async function failureOf(stderr: string): Promise<MediaProcessingError> {
    spawnMock.mockReturnValue(fakeChild(stderr, 1));
    return (await service
      .probe(SIGNED_URL)
      .catch((e: unknown) => e)) as MediaProcessingError;
  }

  it('should never leak the presigned URL or its signature in a retryable error', async () => {
    const error = await failureOf(
      `${SIGNED_URL}: Server returned 403 Forbidden (access denied)`,
    );

    expect(error).toBeInstanceOf(MediaProcessingError);
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain('X-Amz-Signature');
    expect(error.message).not.toContain('X-Amz-Credential');
    expect(error.message).not.toContain('secretkey');
    expect(error.message).not.toContain('minio:9000');
    expect(error.message).toContain('<input>');
    expect(error.message).toContain('403 Forbidden');
  });

  it('should keep the useful diagnosis of a non-retryable error without the URL', async () => {
    const error = await failureOf(
      `${SIGNED_URL}: Invalid data found when processing input`,
    );

    expect(error.retryable).toBe(false);
    expect(error.message).toContain('Invalid data found');
    expect(error.message).not.toContain('X-Amz-Signature');
  });

  it('should sanitize URLs quoted by ffmpeg in single quotes', async () => {
    const error = await failureOf(`Error opening input file '${SIGNED_URL}'.`);

    expect(error.message).not.toContain('X-Amz-Signature');
    expect(error.message).toContain("'<input>'");
  });
});
