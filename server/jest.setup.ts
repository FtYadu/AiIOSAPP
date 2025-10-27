import 'dotenv/config';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://neondb_owner:npg_2X9QlnPMpgVE@ep-falling-mode-ad2jsr6x-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

process.env.S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000';
process.env.S3_REGION = process.env.S3_REGION ?? 'us-east-1';
process.env.S3_ACCESS_KEY = process.env.S3_ACCESS_KEY ?? 'minioadmin';
process.env.S3_SECRET_KEY = process.env.S3_SECRET_KEY ?? 'minioadmin123';
process.env.REIMAGINE_UPLOADS_BUCKET = process.env.REIMAGINE_UPLOADS_BUCKET ?? 'reimagine-uploads';
process.env.REIMAGINE_OUTPUTS_BUCKET = process.env.REIMAGINE_OUTPUTS_BUCKET ?? 'reimagine-outputs';
delete process.env.RABBITMQ_URL;
