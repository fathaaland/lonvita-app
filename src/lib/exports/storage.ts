import { randomUUID } from 'node:crypto'

import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { getS3Client as getClient, s3Bucket as bucket } from '@/lib/s3/client'

/** Same bucket as the media uploads, under its own prefix — nothing to provision for it. */
const EXPORTS_PREFIX = 'exports'

/** Only has to outlive the redirect it's handed out in — the durable link is /api/exports/:id/download. */
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60

/** The random segment matters: the bucket may be publicly readable (it serves the event photos),
 * and "exports/<sequential id>/<predictable name>" would let anyone fetch a report straight from
 * S3, around the owner check in /api/exports/:id/download. */
export const exportFileKey = (exportId: number | string, fileName: string): string =>
  `${EXPORTS_PREFIX}/${exportId}-${randomUUID()}/${fileName}`

export async function uploadExportFile(key: string, body: Buffer, contentType: string): Promise<void> {
  await getClient().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }))
}

/** Presigned GET that makes the browser save the file under its readable name, not the S3 key. */
export async function presignExportDownload(key: string, fileName: string): Promise<string> {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    }),
    { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
  )
}

export async function deleteExportFiles(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  await getClient().send(
    new DeleteObjectsCommand({
      Bucket: bucket(),
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }),
  )
}
