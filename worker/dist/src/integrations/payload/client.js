/**
 * Thin REST client for the Payload backend, replacing the old Supabase client. Frontend
 * and backend are the same Next.js app, so this always calls same-origin — no CORS or
 * SameSite gymnastics needed for the payload-token cookie.
 */
const API_BASE = "/api";
export class PayloadApiError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.name = "PayloadApiError";
        this.status = status;
    }
}
/** Payload's REST create/update-by-id responses wrap the document as `{ doc, message }`, while
 * every caller here wants the document itself. Reading `id` off the wrapper silently gave
 * `undefined` — a freshly created organization or uploaded photo then never got attached to the
 * event. Custom routes (register, login, …) don't use that shape and pass through untouched. */
function unwrapDoc(body) {
    if (body && typeof body === "object" && "doc" in body && "message" in body) {
        return body.doc;
    }
    return body;
}
async function request(path, init) {
    const res = await fetch(`${API_BASE}${path}`, {
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
        },
        ...init,
    });
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message = body?.errors?.[0]?.message ?? body?.error ?? `Request failed with status ${res.status}`;
        throw new PayloadApiError(message, res.status);
    }
    return unwrapDoc(await res.json());
}
export function get(path) {
    return request(path, { method: "GET" });
}
export function post(path, data) {
    return request(path, { method: "POST", body: data ? JSON.stringify(data) : undefined });
}
export function patch(path, data) {
    return request(path, { method: "PATCH", body: data ? JSON.stringify(data) : undefined });
}
export function del(path) {
    return request(path, { method: "DELETE" });
}
/** POST a file straight to a Payload upload collection (multipart — no Content-Type header
 * of our own, so the browser sets the multipart boundary itself). Used for the event cover
 * image (brief §4 "Nahrání fotografie k akci"). */
export async function uploadFile(collection, file, fields) {
    const form = new FormData();
    form.append("file", file);
    // Payload's REST upload convention: every non-file field goes into one "_payload" JSON
    // string field, not as individual form fields (which it 400s on as "missing" instead).
    if (fields && Object.keys(fields).length > 0) {
        form.append("_payload", JSON.stringify(fields));
    }
    const res = await fetch(`${API_BASE}/${collection}`, {
        method: "POST",
        credentials: "include",
        body: form,
    });
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message = body?.errors?.[0]?.message ?? `Upload failed with status ${res.status}`;
        throw new PayloadApiError(message, res.status);
    }
    return unwrapDoc(await res.json());
}
/** Builds a Payload REST `where[...]` query string, e.g. `where[status][equals]=approved`. */
export function buildWhereParams(where) {
    const params = new URLSearchParams();
    for (const [field, ops] of Object.entries(where)) {
        for (const [op, value] of Object.entries(ops)) {
            if (value === undefined)
                continue;
            if (Array.isArray(value)) {
                value.forEach((v) => params.append(`where[${field}][${op}][]`, String(v)));
            }
            else {
                params.set(`where[${field}][${op}]`, String(value));
            }
        }
    }
    return params.toString();
}
export function buildQuery(parts) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(parts)) {
        if (value !== undefined)
            params.set(key, String(value));
    }
    return params.toString();
}
/** GET /api/users/me — resolves the current session from the payload-token cookie. */
export async function getCurrentPayloadUser() {
    try {
        const result = await get("/users/me");
        return result.user ?? null;
    }
    catch {
        return null;
    }
}
/** Redirects the browser to the logout route, which clears the session cookie. */
export function signOutRedirect() {
    window.location.href = "/api/auth/logout";
}
/** Hands the browser to Google's consent screen via our own start route, which mints the CSRF
 * state first. `returnTo` is where the callback lands afterwards (unless onboarding is due). */
export function redirectToGoogle(returnTo = "/") {
    window.location.href = `/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
}
export async function registerAccount(input) {
    return post("/auth/register", { ...input, passwordConfirm: input.password });
}
export async function requestPasswordReset(email) {
    await post("/auth/forgot-password", { email });
}
/** POST /api/auth/reset-password — sets a new password from the token in the emailed link. */
export async function resetPasswordWithToken(token, password) {
    await post("/auth/reset-password", { token, password });
}
/** GET /api/auth/mode — which external sign-in providers are configured. */
export async function getAuthMode() {
    try {
        return await get("/auth/mode");
    }
    catch {
        return { google: false };
    }
}
/**
 * POST /api/users/login — Payload's own built-in local (email/password) auth, used as a
 * Sets the payload-token cookie our custom auth strategy verifies — the same cookie the Google
 * callback mints, so both sign-in paths end in exactly the same session.
 */
export async function loginWithPassword(email, password) {
    const result = await post("/users/login", { email, password });
    return result.user;
}
