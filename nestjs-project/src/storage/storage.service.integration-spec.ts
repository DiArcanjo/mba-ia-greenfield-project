import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import storageConfig from '../config/storage.config';
import {
  deleteKeysByPrefix,
  getRangeViaUrl,
  uploadPartViaPresignedUrl,
} from '../test/storage';
import { STORAGE_KEYS } from './storage.constants';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

const FIVE_MIB = 5 * 1024 * 1024;

describe('StorageService (integration, MinIO)', () => {
  let storage: StorageService;
  const testId = randomUUID();
  const keyPrefix = `videos/${testId}`;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();
    storage = module.get(StorageService);
  });

  afterAll(async () => {
    await deleteKeysByPrefix(keyPrefix);
  });

  async function uploadTwoParts(key: string) {
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
    const part1 = new Uint8Array(FIVE_MIB).fill(1);
    const part2 = new Uint8Array(1024).fill(2);
    for (const [index, bytes] of [part1, part2].entries()) {
      const url = await storage.presignUploadPart(
        key,
        uploadId,
        index + 1,
        600,
      );
      await uploadPartViaPresignedUrl(url, bytes);
    }
    return { uploadId, totalSize: part1.length + part2.length };
  }

  it('builds storage keys from the video id', () => {
    expect(STORAGE_KEYS.videoOriginal('abc')).toBe('videos/abc/original');
    expect(STORAGE_KEYS.videoThumbnail('abc')).toBe('videos/abc/thumbnail.jpg');
  });

  it('should upload two parts, list them, complete and head the object', async () => {
    const key = `${keyPrefix}/original`;
    const { uploadId, totalSize } = await uploadTwoParts(key);

    const parts = await storage.listParts(key, uploadId);
    expect(parts.map((p) => p.partNumber)).toEqual([1, 2]);
    expect(parts.every((p) => p.etag.length > 0)).toBe(true);

    await storage.completeMultipartUpload(
      key,
      uploadId,
      parts.map(({ partNumber, etag }) => ({ partNumber, etag })),
    );

    const head = await storage.headObject(key);
    expect(head.contentLength).toBe(totalSize);
    expect(head.contentType).toBe('video/mp4');
  });

  it('should serve a 206 with 100 bytes for a Range request on a presigned GET', async () => {
    const key = `${keyPrefix}/range`;
    await storage.putObject(key, Buffer.alloc(1000, 7), 'video/mp4');

    const url = await storage.presignGetObject(key, { expiresIn: 600 });
    const response = await getRangeViaUrl(url, 'bytes=0-99');

    expect(response.status).toBe(206);
    expect((await response.arrayBuffer()).byteLength).toBe(100);
  });

  it('should set Content-Disposition attachment when downloadFilename is given', async () => {
    const key = `${keyPrefix}/download`;
    await storage.putObject(key, Buffer.from('hello'), 'video/mp4');

    const url = await storage.presignGetObject(key, {
      expiresIn: 600,
      downloadFilename: 'meu vídeo.mp4',
    });
    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(response.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''meu%20v%C3%ADdeo.mp4",
    );
  });

  it('should fail to head an object after deleteObject', async () => {
    const key = `${keyPrefix}/deleted`;
    await storage.putObject(key, Buffer.from('x'), 'text/plain');

    await storage.deleteObject(key);

    await expect(storage.headObject(key)).rejects.toThrow();
  });

  it('should abort a multipart upload so its parts can no longer be listed', async () => {
    const key = `${keyPrefix}/aborted`;
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');

    await storage.abortMultipartUpload(key, uploadId);

    await expect(storage.listParts(key, uploadId)).rejects.toThrow();
  });
});
