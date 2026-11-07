import { describe, it, expect } from 'vitest'

import { auditExportLockMode } from '../../worker/src/processors/export-audit-trail.processor'

describe('Audit export — how the file is kept write-once', () => {
  it('relies on the bucket lock rule on R2, which rejects object-lock headers', () => {
    expect(
      auditExportLockMode({ S3_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com' } as never),
    ).toBe('bucket')
    expect(
      auditExportLockMode({ S3_ENDPOINT: 'https://abc123.eu.r2.cloudflarestorage.com' } as never),
    ).toBe('bucket')
  })

  it('locks each object on S3 and MinIO', () => {
    expect(auditExportLockMode({ S3_ENDPOINT: 'http://localhost:9000' } as never)).toBe('object')
    expect(auditExportLockMode({} as never)).toBe('object')
  })

  it('follows AUDIT_EXPORT_LOCK when set', () => {
    expect(
      auditExportLockMode({
        S3_ENDPOINT: 'http://localhost:9000',
        AUDIT_EXPORT_LOCK: 'bucket',
      } as never),
    ).toBe('bucket')
    expect(
      auditExportLockMode({
        S3_ENDPOINT: 'https://x.r2.cloudflarestorage.com',
        AUDIT_EXPORT_LOCK: 'object',
      } as never),
    ).toBe('object')
  })
})
