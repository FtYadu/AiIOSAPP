import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

import { runtimeConfig } from '@config/env';

if (!runtimeConfig.databaseUrl) {
  throw new Error('DATABASE_URL is required to start the gateway.');
}

const pool = new Pool({
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
