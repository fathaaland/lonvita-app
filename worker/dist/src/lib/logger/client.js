'use client';
/**
 * Browser half of the logger. Deliberately imports nothing from `./index` or `./correlation`:
 * those pull in `async_hooks` and the BetterStack transport, neither of which belongs in a
 * client bundle. The only thing shared is the wire format of `/api/log`.
 */
const CORRELATION_COOKIE = 'x-correlation-id';
/** Written by `src/proxy.ts` on every navigation, so a crash can be joined to the server-side
 * trace of the request that rendered the page. */
export const readCorrelationId = () => {
    if (typeof document === 'undefined')
        return undefined;
    const value = document.cookie
        .split('; ')
        .find((part) => part.startsWith(`${CORRELATION_COOKIE}=`))
        ?.slice(CORRELATION_COOKIE.length + 1);
    return value ? decodeURIComponent(value) : undefined;
};
export const reportClientError = (report) => {
    if (typeof window === 'undefined')
        return;
    void fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...report,
            url: window.location.href,
            correlationId: readCorrelationId(),
        }),
        // A crash is usually followed by a reload; without this the report dies with the document.
        keepalive: true,
    }).catch(() => {
        // Reporting a failure to report has nowhere to go — swallowing it is the only sane move.
    });
};
