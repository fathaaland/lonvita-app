import { randomUUID } from 'node:crypto'

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

import { getS3Client, s3Bucket } from '@/lib/s3/client'

/** Uploaded programs wait here for the worker only — removed once read (import-events processor).
 * The random segment keeps them out of reach of anyone guessing keys on a public bucket. */
const IMPORTS_PREFIX = 'imports'

export const importFileKey = (fileName: string): string =>
  `${IMPORTS_PREFIX}/${randomUUID()}/${fileName.replace(/[^\w.-]+/g, '_').slice(-80) || 'soubor'}`

export async function uploadImportFile(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({ Bucket: s3Bucket(), Key: key, Body: body, ContentType: contentType }),
  )
}

export async function downloadImportFile(key: string): Promise<Buffer> {
  const result = await getS3Client().send(new GetObjectCommand({ Bucket: s3Bucket(), Key: key }))
  return Buffer.from(await result.Body!.transformToByteArray())
}

export async function deleteImportFile(key: string): Promise<void> {
  await getS3Client().send(new DeleteObjectCommand({ Bucket: s3Bucket(), Key: key }))
}
