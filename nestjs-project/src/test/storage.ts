import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

const BUCKET = process.env.S3_BUCKET ?? 'streamtube-videos';

function createTestS3Client(): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://minio:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY as string,
      secretAccessKey: process.env.S3_SECRET_KEY as string,
    },
    forcePathStyle: true,
  });
}

/** PUTs bytes to a presigned UploadPart URL and returns the part ETag. */
export async function uploadPartViaPresignedUrl(
  url: string,
  bytes: Uint8Array,
): Promise<string> {
  const response = await fetch(url, {
    method: 'PUT',
    body: bytes as BodyInit,
  });
  if (!response.ok) {
    throw new Error(`Part upload failed with status ${response.status}`);
  }
  const etag = response.headers.get('etag');
  if (!etag) throw new Error('Part upload response has no ETag header');
  return etag;
}

/** Removes every object under the prefix (test cleanup). */
export async function deleteKeysByPrefix(prefix: string): Promise<void> {
  const client = createTestS3Client();
  try {
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }),
    );
    const objects = (listed.Contents ?? []).map((o) => ({ Key: o.Key }));
    if (objects.length === 0) return;
    await client.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: objects },
      }),
    );
  } finally {
    client.destroy();
  }
}

/** GETs a (presigned) URL with a Range header. */
export async function getRangeViaUrl(
  url: string,
  range: string,
): Promise<Response> {
  return fetch(url, { headers: { Range: range } });
}
