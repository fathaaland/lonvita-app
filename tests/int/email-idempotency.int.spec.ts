import { describe, it, expect } from 'vitest'

import { idempotencyKeyFor } from '../../worker/src/processors/email.processor'

describe('E-mail idempotency key', () => {
  const mail = ['info@lonvita.cz', 'a@test.local', 'Předmět', '<p>Tělo</p>', undefined]

  it('stays the same for a retry of the same job, so a double send is still caught', () => {
    expect(idempotencyKeyFor('6', mail)).toBe(idempotencyKeyFor('6', [...mail]))
  })

  it('differs when the job id is reused for another e-mail (Redis lost its counter)', () => {
    expect(idempotencyKeyFor('6', mail)).not.toBe(idempotencyKeyFor('6', ['info@lonvita.cz', 'b@test.local', 'Jiný', '<p>Jiné</p>', undefined]))
  })

  it('stays within Resend’s 256 character limit', () => {
    expect(idempotencyKeyFor('x'.repeat(100), mail).length).toBeLessThan(256)
  })
})
