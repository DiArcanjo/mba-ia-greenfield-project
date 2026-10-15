export const FFPROBE_BIN = 'ffprobe';
export const FFMPEG_BIN = 'ffmpeg';

export const FFPROBE_TIMEOUT_MS = 60_000;
export const FFMPEG_TIMEOUT_MS = 120_000;

export const FFPROBE_ARGS = [
  '-v',
  'error',
  '-print_format',
  'json',
  '-show_format',
  '-show_streams',
] as const;

export const THUMBNAIL_WIDTH = 640;
export const MAX_STDERR_LENGTH = 1000;

/** ffprobe/ffmpeg stderr fragments that mean the input is not valid media. */
export const INVALID_MEDIA_PATTERNS = [
  'Invalid data found',
  'moov atom not found',
  'could not find codec parameters',
  // Random bytes can be sniffed as MP3 and fail inside the demuxer.
  'Failed to read frame size',
] as const;

/** Matches any URL; presigned input URLs carry credentials in the query string. */
export const URL_PATTERN = /https?:\/\/[^\s'"]+/g;
export const URL_PLACEHOLDER = '<input>';
