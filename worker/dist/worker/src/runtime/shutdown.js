import { flushLogs, logger } from '@/lib/logger';
export const registerShutdown = (label, workers) => {
    const shutdown = async () => {
        logger.info('Shutting down gracefully', { event: 'worker.shutdown_started', worker: label });
        await Promise.all(workers.map((worker) => worker.close()));
        logger.info('All workers stopped', { event: 'worker.shutdown_completed', worker: label });
        // Shipping is fire-and-forget, so without this the last few lines — the ones explaining
        // why the process is going down — die with the process.
        await flushLogs();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
};
