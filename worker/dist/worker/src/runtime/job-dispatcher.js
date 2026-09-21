import { JOB_NAMES } from '@/lib/queue/contracts';
import { processCleanupNotificationsJob } from '../processors/cleanup-notifications.processor';
import { processEmailJob } from '../processors/email.processor';
import { processSmsJob } from '../processors/sms.processor';
export const dispatchJobByType = async (job, context) => {
    switch (job.jobType) {
        case JOB_NAMES.SEND_EMAIL:
            return processEmailJob(job.payload, context);
        case JOB_NAMES.SEND_SMS:
            return processSmsJob(job.payload, context);
        case JOB_NAMES.CLEANUP_NOTIFICATIONS:
            return processCleanupNotificationsJob();
        default:
            throw new Error(`Unsupported job type: ${job.jobType}`);
    }
};
