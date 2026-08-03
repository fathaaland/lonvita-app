import { queueConnectionOptions } from '@/lib/valkey/client'

export const queueOptions = {
  connection: queueConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 1000 },
    removeOnComplete: {
      age: 60 * 60 * 24,
      count: 500,
    },
    removeOnFail: {
      age: 60 * 60 * 24 * 7,
      count: 1000,
    },
  },
}
