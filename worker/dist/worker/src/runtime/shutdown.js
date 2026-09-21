import { flushLogs, logger } from '@/lib/logger';
export const registerShutdown = (label, workers) => {
    const shutdown = async () => {
        logger.info(`[${label}] Shutting down gracefully...`);
        await Promise.all(workers.map((worker) => worker.close()));
        logger.info(`[${label}] All workers stopped`);
        // Shipping is fire-and-forget, so without this the last few lines — the ones explaining
        // why the process is going down — die with the process.
        await flushLogs();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
};
