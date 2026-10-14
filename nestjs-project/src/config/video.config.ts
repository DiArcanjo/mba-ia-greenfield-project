import { registerAs } from '@nestjs/config';

export default registerAs('video', () => ({
  maxSizeBytes: parseInt(process.env.VIDEO_MAX_SIZE_BYTES || '10737418240', 10),
  partSizeBytes: parseInt(process.env.VIDEO_PART_SIZE_BYTES || '67108864', 10),
  partUrlTtlSeconds: parseInt(
    process.env.VIDEO_PART_URL_TTL_SECONDS || '3600',
    10,
  ),
  streamUrlTtlSeconds: parseInt(
    process.env.VIDEO_STREAM_URL_TTL_SECONDS || '10800',
    10,
  ),
}));
