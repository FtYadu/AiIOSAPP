import { randomUUID } from 'node:crypto';

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { newDb } from 'pg-mem';

import { runtimeConfig } from '@config/env';

const useInMemoryDb = process.env.USE_IN_MEMORY_DB === 'true';

if (!useInMemoryDb && !runtimeConfig.databaseUrl) {
  throw new Error('DATABASE_URL is required to start the gateway.');
}

const createInMemoryPool = (): Pool => {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'gen_random_uuid',
    implementation: () => randomUUID()
  });
  db.public.none(`
    create table providers (
      key text primary key,
      enabled boolean not null default true,
      weight integer not null default 1,
      created_at timestamptz not null default now()
    );

    create table image_jobs (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      status text not null check (status in ('queued','running','succeeded','failed')),
      prompt text not null,
      strength real,
      guidance real,
      seed bigint,
      size text,
      output_format text,
      n integer,
      provider text references providers(key),
      init_image_url text,
      mask_url text,
      error text,
      metadata jsonb default '{}'::jsonb,
      webhook_url text,
      idempotency_key text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create unique index idx_image_jobs_user_idempotency
      on image_jobs(user_id, idempotency_key)
      where idempotency_key is not null;

    create table image_assets (
      id uuid primary key default gen_random_uuid(),
      job_id uuid not null references image_jobs(id) on delete cascade,
      kind text not null check (kind in ('init','mask','output')),
      storage_path text not null,
      public_url text,
      mime text,
      width integer,
      height integer,
      sha256 text,
      created_at timestamptz not null default now()
    );
  `);

  const adapter = db.adapters.createPg();
  const InMemoryPool = adapter.Pool;
  return new InMemoryPool() as unknown as Pool;
};

const pool: Pool = useInMemoryDb
  ? createInMemoryPool()
  : new Pool({
      connectionString: runtimeConfig.databaseUrl
    });

export const db = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    return pool.query<T>(text, params);
  },

  async withClient<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }
};
