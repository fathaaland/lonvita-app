import { CreateBucketCommand } from '@aws-sdk/client-s3'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { getS3Client } from '@/lib/s3/client'

import {
  AuditLockNotEnforcedError,
  verifyWriteOnce,
} from '../../worker/src/processors/export-audit-trail.processor'

// The nightly audit copy checks that its bucket really is write-once before it writes anything —
// against the MinIO of docker-compose / CI: one bucket created with Object Lock, one without.

const LOCKED = 'lonvita-audit-test-locked'
const PLAIN = 'lonvita-audit-test-plain'

const ensureBucket = async (Bucket: string, ObjectLockEnabledForBucket: boolean) => {
  await getS3Client()
    .send(new CreateBucketCommand({ Bucket, ObjectLockEnabledForBucket }))
    .catch((error: { name?: string }) => {
      if (error.name !== 'BucketAlreadyOwnedByYou' && error.name !== 'BucketAlreadyExists')
        throw error
    })
}

describe('audit export — write-once check', () => {
  beforeAll(async () => {
    await ensureBucket(LOCKED, true)
    await ensureBucket(PLAIN, false)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('passes on a bucket that keeps a COMPLIANCE lock (object mode)', async () => {
    vi.stubEnv('AUDIT_EXPORT_LOCK', 'object')
    // A month here (production locks 18+): the probe stays locked in the local test bucket.
    await expect(verifyWriteOnce(LOCKED, 1, new Date())).resolves.toBeUndefined()
  })

  it('refuses a bucket without Object Lock (object mode)', async () => {
    vi.stubEnv('AUDIT_EXPORT_LOCK', 'object')
    await expect(verifyWriteOnce(PLAIN, 18, new Date())).rejects.toBeInstanceOf(
      AuditLockNotEnforcedError,
    )
  })

  it('refuses a bucket that lets the probe be deleted (bucket mode, as on R2)', async () => {
    vi.stubEnv('AUDIT_EXPORT_LOCK', 'bucket')
    await expect(verifyWriteOnce(PLAIN, 18, new Date())).rejects.toBeInstanceOf(
      AuditLockNotEnforcedError,
    )
  })
})
