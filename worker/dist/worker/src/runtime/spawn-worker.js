import { Worker } from 'bullmq';
import { logger, serializeError } from '@/lib/logger';
import { runWithCorrelationId } from '@/lib/logger/correlation';
import { QUEUE_NAME } from '@/lib/queue/contracts';
import { queueConnectionOptions } from '@/lib/valkey/client';
import { dispatchJobByType } from './job-dispatcher';
const getConcurrency = () => {
    const envValue = process.env.WORKER_QUEUE_CONCURRENCY;
    const parsed = Number(envValue);
    if (envValue && Number.isInteger(parsed) && parsed > 0) {
        return parsed;
    }
    return 5;
};
export const spawnQueueWorker = () => {
    const concurrency = getConcurrency();
    const worker = new Worker(QUEUE_NAME, async (job) => {
        // Re-enter the trace the web request started: everything the processors log from here
        // on carries the same correlationId as the HTTP request that enqueued the job, so a
        // failed e-mail on Railway lines up with the click on Vercel that asked for it.
        return runWithCorrelationId(job.data.correlationId ?? 'no-correlation-id', () => dispatchJobByType(job.data, {
            jobId: job.id,
            attemptsMade: job.attemptsMade,
        }));
    }, {
        connection: queueConnectionOptions,
        concurrency,
    });
    worker.on('completed', (job, result) => {
        logger.info('Queue job completed', {
            event: 'queue.job_completed',
            jobId: job.id,
            jobType: job.data.jobType,
            correlationId: job.data.correlationId,
            result,
        });
    });
    worker.on('failed', (job, err) => {
        logger.error('Queue job failed', {
            event: 'queue.job_failed',
            jobId: job?.id,
            jobType: job?.data.jobType,
            attemptsMade: job?.attemptsMade,
            // A job that has used up its attempts is gone for good unless somebody replays it — the
            // distinction decides whether this line needs acting on.
            exhausted: job ? job.attemptsMade >= (job.opts?.attempts ?? 1) : undefined,
            correlationId: job?.data.correlationId,
            ...serializeError(err),
        });
    });
    worker.on('stalled', (jobId) => {
        logger.warn('Queue job stalled', { event: 'queue.job_stalled', jobId });
    });
    worker.on('error', (err) => {
        logger.error('Queue worker error', { event: 'queue.worker_error', ...serializeError(err) });
    });
    logger.info('Queue worker started', { event: 'queue.worker_started', queue: QUEUE_NAME, concurrency });
    return {
        name: worker.name,
        close: () => worker.close(),
    };
};
