export const S3_CLIENT = Symbol('S3_CLIENT');
export const S3_PRESIGN_CLIENT = Symbol('S3_PRESIGN_CLIENT');

export const STORAGE_KEYS = {
  videoOriginal: (id: string) => `videos/${id}/original`,
  videoThumbnail: (id: string) => `videos/${id}/thumbnail.jpg`,
} as const;
