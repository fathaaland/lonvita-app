import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

import { processCleanupNotificationsJob } from '../../worker/src/processors/cleanup-notifications.processor'

// Retention: read notifications survive 30 days, unread ones 90, both measured from createdAt.

let payload: Payload
let owner: { id: number }

const STAMP = Date.now()
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString()

const make = async (label: string, ageDays: number, read: boolean) => {
  const doc = await payload.create({
    collection: 'notifications',
    data: {
      user: owner.id,
      title: label,
      message: label,
      readAt: read ? daysAgo(ageDays) : null,
      createdAt: daysAgo(ageDays),
    },
    overrideAccess: true,
  })
  // Payload stamps createdAt itself on create, so back-date it afterwards — without this every
  // fixture would be brand new and nothing would ever qualify.
  await payload.update({
    collection: 'notifications',
    id: doc.id,
    data: { createdAt: daysAgo(ageDays) },
    overrideAccess: true,
  })
  return doc.id
}

const survivingTitles = async (): Promise<string[]> => {
  const left = await payload.find({
    collection: 'notifications',
    where: { user: { equals: owner.id } },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  return left.docs.map((doc) => doc.title).sort()
}

describe('Notification retention cleanup', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    owner = await payload.create({
      collection: 'users',
      data: { email: `notif-cleanup-${STAMP}@test.local`, password: 'test1234', role: 'user' },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await payload.delete({ collection: 'users', id: owner.id, overrideAccess: true }).catch(() => {})
  })

  it('keeps what is still within retention and drops what is past it', async () => {
    await make('read-recent', 10, true)
    await make('read-expired', 40, true)
    await make('unread-recent', 10, false)
    await make('unread-middle-aged', 40, false)
    await make('unread-expired', 100, false)
    await make('read-ancient', 100, true)

    const result = await processCleanupNotificationsJob()

    expect(await survivingTitles()).toEqual(['read-recent', 'unread-middle-aged', 'unread-recent'])
    // Other suites share this database, so the total can be higher — but never lower.
    expect(result.deleted).toBeGreaterThanOrEqual(3)
  })

  it('is a no-op on a second run', async () => {
    const result = await processCleanupNotificationsJob()

    expect(result.deleted).toBe(0)
    expect(await survivingTitles()).toEqual(['read-recent', 'unread-middle-aged', 'unread-recent'])
  })

  it('leaves an unread notification alone right up to the retention edge', async () => {
    await make('unread-89-days', 89, false)
    await make('unread-91-days', 91, false)

    await processCleanupNotificationsJob()

    expect(await survivingTitles()).toContain('unread-89-days')
    expect(await survivingTitles()).not.toContain('unread-91-days')
  })
})
