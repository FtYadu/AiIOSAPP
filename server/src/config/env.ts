import dotenv from 'dotenv';

dotenv.config();

export const runtimeConfig = {
  port: Number.parseInt(process.env.PORT ?? '8080', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  remoteConfigTable: process.env.REMOTE_CONFIG_TABLE ?? 'provider_routes',
  metricsEnabled: process.env.METRICS_ENABLED === 'true',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT ?? process.env.MINIO_ENDPOINT ?? 'http://127.0.0.1:9000',
  s3Region: process.env.S3_REGION ?? 'us-east-1',
  s3AccessKey: process.env.S3_ACCESS_KEY ?? process.env.MINIO_ROOT_USER ?? 'minioadmin',
  s3SecretKey: process.env.S3_SECRET_KEY ?? process.env.MINIO_ROOT_PASSWORD ?? 'minioadmin123',
  uploadsBucket: process.env.REIMAGINE_UPLOADS_BUCKET ?? 'reimagine-uploads',
  outputsBucket: process.env.REIMAGINE_OUTPUTS_BUCKET ?? 'reimagine-outputs',
  rabbitUrl: process.env.RABBITMQ_URL,
  rabbitQueue: process.env.RABBITMQ_QUEUE ?? 'my-tasks',
  webhookSigningSecret: process.env.WEBHOOK_SIGNING_SECRET ?? null
} as const;
