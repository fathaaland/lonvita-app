import { AsyncLocalStorage } from 'node:async_hooks';
export const CORRELATION_ID_HEADER = 'x-correlation-id';
/** What a log line carries when nothing upstream supplied an id — deliberately a readable
 * sentinel rather than an empty string, so "logs that lost their trace" stay filterable. */
export const NO_CORRELATION_ID = 'no-correlation-id';
const storage = new AsyncLocalStorage();
/**
 * The proxy (src/proxy.ts) mints the id and puts it on the *request* headers, so anything
 * holding a Payload `req` or a `Request` can read it straight off — that is the primary path
 * and needs no async storage at all. This store exists for the one place that has no request:
 * a queue job running in the worker, where the id arrived inside the job payload instead.
 */
export const runWithCorrelationId = (correlationId, fn) => storage.run({ correlationId }, fn);
export const getCorrelationId = () => storage.getStore()?.correlationId ?? NO_CORRELATION_ID;
/**
 * Payload hands hooks a WHATWG `Headers` on the REST path but a plain object when the same
 * operation is driven through the Local API (seeding, the worker's cleanup job), so both
 * shapes have to be read. Falls back to the async store, then to the sentinel.
 */
export const correlationIdFromHeaders = (headers) => {
    if (!headers)
        return getCorrelationId();
    const getter = headers.get;
    if (typeof getter === 'function') {
        const value = getter.call(headers, CORRELATION_ID_HEADER);
        if (value)
            return value;
    }
    const value = headers[CORRELATION_ID_HEADER];
    if (typeof value === 'string' && value.length > 0)
        return value;
    return getCorrelationId();
};
