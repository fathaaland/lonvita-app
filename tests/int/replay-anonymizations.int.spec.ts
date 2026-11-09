// @vitest-environment node
import { CreateBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { beforeAll, describe, expect, it } from 'vitest'

import { getS3Client } from '@/lib/s3/client'
import {
  anonymizedIdsInAuditCopy,
  replayAnonymizations,
} from '@/lib/retention/replay-anonymizations'

// A restore brings back accounts deleted after the dump; their deletions, read from the write-once
// audit copy, are carried out again.

const BUCKET = 'lonvita-audit-test-replay'
const STAMP = Date.now()
let payload: Payload

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const keyFor = (d: string) => `audit-trail/${d.slice(0, 4)}/${d.slice(5, 7)}/${d}.jsonl`

describe('replaying deletions after a restore', () => {
  let deleted: { id: number }
  let kept: { id: number }

  beforeAll(async () => {
    payload = await getPayload({ config })
    await getS3Client()
      .send(new CreateBucketCommand({ Bucket: BUCKET }))
      .catch((error: { name?: string }) => {
        if (error.name !== 'BucketAlreadyOwnedByYou' && error.name !== 'BucketAlreadyExists')
          throw error
      })
    const make = async (label: string) => {
      const user = await payload.create({
        collection: 'users',
        data: {
          email: `replay-${label}-${STAMP}@test.local`,
          password: 'test12345678',
          role: 'user',
        },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'profiles',
        data: { user: user.id, fullName: `Replay ${label}` },
        overrideAccess: true,
      })
      return user
    }
    deleted = await make('deleted')
    kept = await make('kept')

    // Yesterday's copy: the deletion of one account (and a refused attempt on the other).
    const lines = [
      { type: 'manifest', day: day(-1) },
      {
        type: 'audit-log',
        row: { action: 'users.anonymize', target_id: String(deleted.id), outcome: 'success' },
      },
      {
        type: 'audit-log',
        row: { action: 'users.anonymize', target_id: String(kept.id), outcome: 'failure' },
      },
      {
        type: 'audit-log',
        row: { action: 'users.update', target_id: String(kept.id), outcome: 'success' },
      },
    ]
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: keyFor(day(-1)),
        Body: lines.map((l) => JSON.stringify(l)).join('\n'),
      }),
    )
  })

  it('finds the deleted accounts in the audit copy, and says which days have no copy', async () => {
    const { ids, missingDays } = await anonymizedIdsInAuditCopy(BUCKET, day(-2))
    expect(ids).toEqual([deleted.id])
    expect(missingDays).toContain(day(-2))
  })

  it('a dry run changes nothing', async () => {
    const outcome = await replayAnonymizations(payload, [deleted.id], { dryRun: true })
    expect(outcome.anonymized).toEqual([deleted.id])
    const user = await payload.findByID({
      collection: 'users',
      id: deleted.id,
      overrideAccess: true,
    })
    expect(user.anonymizedAt).toBeFalsy()
  })

  it('anonymizes the account again and records that it did', async () => {
    const outcome = await replayAnonymizations(payload, [deleted.id])
    expect(outcome).toMatchObject({ anonymized: [deleted.id], refused: [] })
    const user = await payload.findByID({
      collection: 'users',
      id: deleted.id,
      overrideAccess: true,
    })
    expect(user.anonymizedAt).toBeTruthy()
    expect(user.email).toBe(`smazany-${deleted.id}@anonymized.invalid`)
    const entries = await payload.find({
      collection: 'audit-log',
      where: {
        and: [
          { action: { equals: 'users.anonymize-replayed' } },
          { targetId: { equals: String(deleted.id) } },
        ],
      },
      overrideAccess: true,
    })
    expect(entries.totalDocs).toBe(1)

    // Run twice — the second finds nothing left to do.
    expect(await replayAnonymizations(payload, [deleted.id])).toMatchObject({
      anonymized: [],
      alreadyGone: [deleted.id],
    })
  })
})
