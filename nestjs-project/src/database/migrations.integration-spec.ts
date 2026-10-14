import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { CreateUsersAndChannels1775687773260 } from './migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from './migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1792020407991 } from './migrations/1792020407991-CreateVideos';
import { Video } from '../videos/entities/video.entity';
import { createTestDataSource } from '../test/create-test-data-source';

const MANAGED_TABLES = [
  'users',
  'channels',
  'refresh_tokens',
  'verification_tokens',
  'videos',
];

const MANAGED_ENUM_TYPES = [
  'verification_tokens_type_enum',
  'video_processing_status',
  'video_publication_status',
];

async function resetSchema(dataSource: DataSource): Promise<void> {
  for (const table of [...MANAGED_TABLES, 'migrations']) {
    await dataSource.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
  }
  for (const enumType of MANAGED_ENUM_TYPES) {
    await dataSource.query(`DROP TYPE IF EXISTS "${enumType}" CASCADE`);
  }
}

describe('Database migrations (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource(
      [User, Channel, RefreshToken, VerificationToken, Video],
      {
        synchronize: false,
        migrations: [
          CreateUsersAndChannels1775687773260,
          CreateAuthTokens1777579850478,
          CreateVideos1792020407991,
        ],
      },
    );

    await dataSource.initialize();

    await resetSchema(dataSource);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      // The second test undoes the last migration, leaving token tables missing.
      // Start from a clean schema and re-apply so the shared DB is fully
      // migrated when subsequent suites run.
      await resetSchema(dataSource);
      await dataSource.runMigrations();
    } finally {
      await dataSource.destroy();
    }
  });

  it('should apply all migrations and create all five tables', async () => {
    const ranMigrations = await dataSource.runMigrations();

    expect(ranMigrations).toHaveLength(3);

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [MANAGED_TABLES],
    );
    const tableNames = result.map((r) => r.table_name);
    expect(tableNames).toEqual([
      'channels',
      'refresh_tokens',
      'users',
      'verification_tokens',
      'videos',
    ]);
  });

  it('should revert the videos migration, dropping the table and enum types, and reapply it', async () => {
    await dataSource.undoLastMigration();

    const tables = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'videos'`,
    );
    expect(tables).toHaveLength(0);
    const types = await dataSource.query<{ typname: string }[]>(
      `SELECT typname FROM pg_type
       WHERE typname IN ('video_processing_status', 'video_publication_status')`,
    );
    expect(types).toHaveLength(0);

    await dataSource.runMigrations();
    const reapplied = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'videos'`,
    );
    expect(reapplied).toHaveLength(1);
  });

  it('should revert the token migration and remove token tables', async () => {
    await dataSource.undoLastMigration();
    await dataSource.undoLastMigration();

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [['refresh_tokens', 'verification_tokens']],
    );
    expect(result).toHaveLength(0);
  });
});
