import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  S3_ACCESS_KEY: 'access',
  S3_SECRET_KEY: 'secret',
};

const validate = (
  env: Record<string, string>,
  required: Record<string, string> = requiredEnv,
) =>
  envValidationSchema.validate(
    { ...required, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const result = validate({});
    expect(result.error).toBeUndefined();
    expect((result.value as Record<string, string>).SWAGGER_ENABLED).toBe(
      'false',
    );
  });
});

describe('envValidationSchema — storage, queue and video', () => {
  it('should reject a missing S3_ACCESS_KEY', () => {
    const rest = { ...requiredEnv } as Record<string, string>;
    delete rest.S3_ACCESS_KEY;
    const { error } = validate({}, rest);
    expect(error!.message).toContain('S3_ACCESS_KEY');
  });

  it('should reject a missing S3_SECRET_KEY', () => {
    const rest = { ...requiredEnv } as Record<string, string>;
    delete rest.S3_SECRET_KEY;
    const { error } = validate({}, rest);
    expect(error!.message).toContain('S3_SECRET_KEY');
  });

  it('should apply defaults for redis host, queue prefix and bucket', () => {
    const result = validate({});
    expect(result.error).toBeUndefined();
    const env = result.value as Record<string, unknown>;
    expect(env.REDIS_HOST).toBe('redis');
    expect(env.QUEUE_PREFIX).toBe('streamtube');
    expect(env.S3_BUCKET).toBe('streamtube-videos');
    expect(env.VIDEO_PART_SIZE_BYTES).toBe(67108864);
  });

  it('should reject VIDEO_PART_SIZE_BYTES below the 5 MiB S3 minimum', () => {
    const { error } = validate({
      VIDEO_PART_SIZE_BYTES: '1024',
    });
    expect(error!.message).toContain('VIDEO_PART_SIZE_BYTES');
  });

  it('should accept VIDEO_PART_SIZE_BYTES at the 5 MiB minimum', () => {
    const { error } = validate({
      VIDEO_PART_SIZE_BYTES: '5242880',
    });
    expect(error).toBeUndefined();
  });
});
