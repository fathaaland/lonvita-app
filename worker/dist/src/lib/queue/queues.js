import { Queue } from 'bullmq';
import { getCorrelationId } from '@/lib/logger/correlation';
import { JOB_NAMES, QUEUE_NAME } from './contracts';
import { queueOptions } from './options';
let queueInstance;
export const getQueue = () => {
    if (!queueInstance) {
        queueInstance = new Queue(QUEUE_NAME, queueOptions);
    }
    return queueInstance;
};
const enqueueJob = (job, options) => {
    const traced = { ...job, correlationId: options?.correlationId ?? getCorrelationId() };
    return getQueue().add(job.jobType, traced, {
        ...(options?.jobId ? { jobId: options.jobId } : {}),
        ...(options?.delay ? { delay: options.delay } : {}),
    });
};
export async function enqueueEmail(data, options) {
    return enqueueJob({ jobType: JOB_NAMES.SEND_EMAIL, payload: data }, options);
}
export async function enqueueSms(data, options) {
    return enqueueJob({ jobType: JOB_NAMES.SEND_SMS, payload: data }, options);
}
