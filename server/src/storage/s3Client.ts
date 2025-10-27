import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { runtimeConfig } from '@config/env';

const s3Client = new S3Client({
  region: runtimeConfig.s3Region,
  endpoint: runtimeConfig.s3Endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: runtimeConfig.s3AccessKey,
    secretAccessKey: runtimeConfig.s3SecretKey
  }
});

export { s3Client, PutObjectCommand, getSignedUrl };
