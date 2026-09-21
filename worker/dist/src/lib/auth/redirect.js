export const CURRENT_PATH_HEADER = 'x-current-path';
/** Only ever allow same-origin relative paths — guards against open-redirect via query params. */
export const getSafeRedirectPath = (path, fallback) => {
    if (!path)
        return fallback;
    if (!path.startsWith('/') || path.startsWith('//'))
        return fallback;
    try {
        new URL(path, 'http://localhost');
    }
    catch {
        return fallback;
    }
    return path;
};
