import 'dotenv/config';
import { getPayload } from 'payload';
import config from './payload.config';
import { logger, serializeError, flushLogs } from './lib/logger';
import { runSeed } from './lib/seed/run';
const run = async () => {
    const payload = await getPayload({ config });
    await runSeed(payload);
    process.exit(0);
};
run().catch(async (error) => {
    logger.error('Seed CLI failed', { event: 'seed.cli_failed', ...serializeError(error) });
    await flushLogs();
    process.exit(1);
});
