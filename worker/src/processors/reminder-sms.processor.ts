import { logger } from '@/lib/logger'

import type { ReminderSmsJobData, ReminderSmsJobResult } from '@/lib/queue/contracts'

/**
 * The day-before SMS reminder was discontinued on 12. 11. 2026 — Lonvita texts only "akce byla
 * zrušena" (lib/billing/sms). Reminders delayed before then still arrive, sometimes months later; they
 * are dropped here unsent (the e-mail reminder goes out as before).
 */
export const processReminderSmsJob = async (data: ReminderSmsJobData): Promise<ReminderSmsJobResult> => {
  logger.info('Reminder SMS dropped — SMS go out only on a cancellation', {
    event: 'reminder_sms.discontinued',
    registrationId: data.registrationId,
  })
  return { sent: 0, skipped: 'discontinued' }
}
