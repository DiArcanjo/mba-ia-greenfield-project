export interface MediaMetadata {
  durationSeconds: number;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  formatName: string | null;
}

export class MediaProcessingError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'MediaProcessingError';
  }
}
