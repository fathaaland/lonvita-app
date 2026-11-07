import { Queue } from 'bullmq'

import { getCorrelationId } from '@/lib/logger/correlation'

import { EMAIL_QUEUE_NAME, HEAVY_QUEUE_NAME, JOB_NAMES, QUEUE_NAME, SMS_QUEUE_NAME } from './contracts'
import { deliveryJobOptions, queueOptions } from './options'

import type { DeduplicationOptions, DefaultJobOptions } from 'bullmq'
import type {
  AttendanceReminderJobData,
  EmailJobData,
  EventCancelledJobData,
  EventUpdatedJobData,
  ExportReadyJobData,
  FeedbackRequestJobData,
  GenerateExportJobData,
  ImportEventsJobData,
  JobName,
  PasswordResetJobData,
  QueueJobEnvelope,
  RegistrationDigestJobData,
  ReminderSmsJobData,
  SmsJobData,
} from './contracts'

type AppQueue = Queue<QueueJobEnvelope, unknown, JobName>

const queues = new Map<string, AppQueue>()

const queueNamed = (name: string, defaultJobOptions: DefaultJobOptions = queueOptions.defaultJobOptions): AppQueue => {
  let queue = queues.get(name)
  if (!queue) {
    queue = new Queue<QueueJobEnvelope, unknown, JobName>(name, { ...queueOptions, defaultJobOptions })
    queues.set(name, queue)
  }
  return queue
}

/** The main queue — everything but the e-mails and SMS themselves. */
export const getQueue = (): AppQueue => queueNamed(QUEUE_NAME)

/** E-mails (incl. the delayed 24h reminders) and SMS — see EMAIL_QUEUE_NAME. */
export const getEmailQueue = (): AppQueue => queueNamed(EMAIL_QUEUE_NAME, deliveryJobOptions)
export const getSmsQueue = (): AppQueue => queueNamed(SMS_QUEUE_NAME, deliveryJobOptions)
/** Imports and export rendering — see HEAVY_QUEUE_NAME. */
export const getHeavyQueue = (): AppQueue => queueNamed(HEAVY_QUEUE_NAME)

/**
 * How long an add may take before the caller gives up on it. ioredis queues commands while Redis is
 * unreachable and BullMQ never gives up on them itself, so without this a request (or a hook still
 * holding its transaction) would wait for Redis to come back. The add may still go through once it
 * does — at least once is what the job ids are for.
 */
const ENQUEUE_TIMEOUT_MS = 5_000

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Queue unavailable: no answer from Redis within ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export type EnqueueOptions = {
  jobId?: string
  delay?: number
  correlationId?: string
  deduplication?: DeduplicationOptions
}

const enqueueJob = (job: QueueJobEnvelope, options?: EnqueueOptions, queue: AppQueue = getQueue()) => {
  const traced = { ...job, correlationId: options?.correlationId ?? getCorrelationId() }

  return withTimeout(
    queue.add(job.jobType, traced, {
      ...(options?.jobId ? { jobId: options.jobId } : {}),
      ...(options?.delay ? { delay: options.delay } : {}),
      ...(options?.deduplication ? { deduplication: options.deduplication } : {}),
    }),
    ENQUEUE_TIMEOUT_MS,
  )
}

export async function enqueueEmail(data: EmailJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.SEND_EMAIL, payload: data }, options, getEmailQueue())
}

export async function enqueueSms(data: SmsJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.SEND_SMS, payload: data }, options, getSmsQueue())
}

export async function enqueueFeedbackRequest(data: FeedbackRequestJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.FEEDBACK_REQUEST, payload: data }, options)
}

export async function enqueueGenerateExport(data: GenerateExportJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.GENERATE_EXPORT, payload: data }, options, getHeavyQueue())
}

export async function enqueueExportReady(data: ExportReadyJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.EXPORT_READY, payload: data }, options)
}

/** Edits within this window after the first one ride along in its job instead of adding their own. */
export const EVENT_UPDATED_DEBOUNCE_MS = 60_000
/** Past the debounce window, so the last edit it swallowed has long committed when the job reads. */
const EVENT_UPDATED_DELAY_MS = EVENT_UPDATED_DEBOUNCE_MS + 5_000

/**
 * Debounced per event: while the first edit's job is inside its window, later adds are dropped —
 * data included — so the job keeps the pre-burst baseline and notifies once about all of it.
 */
export async function enqueueEventUpdated(data: EventUpdatedJobData, options?: EnqueueOptions) {
  return enqueueJob(
    { jobType: JOB_NAMES.EVENT_UPDATED, payload: data },
    {
      delay: EVENT_UPDATED_DELAY_MS,
      deduplication: { id: `event-updated-${data.eventId}`, ttl: EVENT_UPDATED_DEBOUNCE_MS },
      ...options,
    },
  )
}

export async function enqueueEventCancelled(data: EventCancelledJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.EVENT_CANCELLED, payload: data }, options)
}

export async function enqueuePasswordReset(data: PasswordResetJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.PASSWORD_RESET, payload: data }, options)
}

export async function enqueueAttendanceReminder(data: AttendanceReminderJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.ATTENDANCE_REMINDER, payload: data }, options)
}

/** "Zkontrolovat teď" in the superadmin's Compliance — the nightly check at once. One a minute at
 * most: a second press while it runs rides along. */
export async function enqueueComplianceCheck(options?: EnqueueOptions) {
  return enqueueJob(
    { jobType: JOB_NAMES.COMPLIANCE_CHECK, payload: {} },
    { deduplication: { id: 'compliance-check-manual', ttl: 60_000 }, ...options },
  )
}

export async function enqueueReminderSms(data: ReminderSmsJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.REMINDER_SMS, payload: data }, options)
}

export async function enqueueRegistrationDigest(data: RegistrationDigestJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.REGISTRATION_DIGEST, payload: data }, options)
}

export async function enqueueImportEvents(data: ImportEventsJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.IMPORT_EVENTS, payload: data }, options, getHeavyQueue())
}
