import { spawn } from 'node:child_process';
import { Injectable } from '@nestjs/common';
import {
  FFMPEG_BIN,
  FFMPEG_TIMEOUT_MS,
  FFPROBE_ARGS,
  FFPROBE_BIN,
  FFPROBE_TIMEOUT_MS,
  INVALID_MEDIA_PATTERNS,
  MAX_STDERR_LENGTH,
  THUMBNAIL_WIDTH,
  URL_PATTERN,
  URL_PLACEHOLDER,
} from './media.constants';
import { MediaProcessingError, type MediaMetadata } from './media.types';

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
}

interface ProbeOutput {
  streams?: ProbeStream[];
  format?: { duration?: string; format_name?: string };
}

/** Strips URLs (presigned ones embed X-Amz-Signature/Credential) from tool output. */
function sanitize(text: string): string {
  return text.replace(URL_PATTERN, URL_PLACEHOLDER);
}

interface ToolResult {
  stdout: Buffer;
  stderr: string;
}

@Injectable()
export class MediaToolsService {
  async probe(url: string): Promise<MediaMetadata> {
    const { stdout } = await this.run(
      FFPROBE_BIN,
      [...FFPROBE_ARGS, url],
      FFPROBE_TIMEOUT_MS,
    );

    let output: ProbeOutput;
    try {
      output = JSON.parse(stdout.toString('utf8')) as ProbeOutput;
    } catch {
      throw new MediaProcessingError('ffprobe returned invalid JSON', false);
    }

    const video = output.streams?.find((s) => s.codec_type === 'video');
    if (!video) {
      throw new MediaProcessingError('No video stream found', false);
    }

    const duration = Number(output.format?.duration);
    return {
      durationSeconds: Number.isFinite(duration) ? duration : 0,
      width: video.width ?? null,
      height: video.height ?? null,
      videoCodec: video.codec_name ?? null,
      formatName: output.format?.format_name ?? null,
    };
  }

  async extractThumbnail(url: string, atSeconds: number): Promise<Buffer> {
    const { stdout } = await this.run(
      FFMPEG_BIN,
      [
        '-v',
        'error',
        '-ss',
        String(atSeconds),
        '-i',
        url,
        '-frames:v',
        '1',
        '-vf',
        `scale=${THUMBNAIL_WIDTH}:-2`,
        '-f',
        'image2',
        '-c:v',
        'mjpeg',
        'pipe:1',
      ],
      FFMPEG_TIMEOUT_MS,
    );

    if (stdout.length === 0) {
      throw new MediaProcessingError('ffmpeg produced no thumbnail', false);
    }
    return stdout;
  }

  private run(
    bin: string,
    args: string[],
    timeoutMs: number,
  ): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      let stderr = '';
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(() =>
          reject(new MediaProcessingError(`${bin} timed out`, true)),
        );
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_STDERR_LENGTH) stderr += chunk.toString();
      });

      child.on('error', (err) =>
        finish(() =>
          reject(
            new MediaProcessingError(
              `Failed to run ${bin}: ${sanitize(err.message)}`,
              true,
            ),
          ),
        ),
      );

      child.on('close', (code) =>
        finish(() => {
          if (code === 0) {
            resolve({ stdout: Buffer.concat(stdout), stderr });
            return;
          }
          const detail = sanitize(stderr.trim()).slice(0, MAX_STDERR_LENGTH);
          const invalid = INVALID_MEDIA_PATTERNS.some((p) =>
            detail.includes(p),
          );
          reject(
            new MediaProcessingError(
              `${bin} exited with code ${code}: ${detail}`,
              !invalid,
            ),
          );
        }),
      );
    });
  }
}
