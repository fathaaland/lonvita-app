import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3'

export const s3ClientConfig: S3ClientConfig = {
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
  region: process.env.S3_REGION!,
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
}

let client: S3Client | undefined

/** One client per process for our own reads and writes (the media uploads go through Payload's). */
export const getS3Client = (): S3Client => {
  client ??= new S3Client(s3ClientConfig)
  return client
}

export const s3Bucket = (): string => process.env.S3_BUCKET!
