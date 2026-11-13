/**
 * Thin REST client for the Payload backend, replacing the old Supabase client. Frontend
 * and backend are the same Next.js app, so this always calls same-origin — no CORS or
 * SameSite gymnastics needed for the payload-token cookie.
 */

const API_BASE = "/api";

export class PayloadApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PayloadApiError";
    this.status = status;
  }
}

/** Payload's REST create/update-by-id responses wrap the document as `{ doc, message }`, while
 * every caller here wants the document itself. Reading `id` off the wrapper silently gave
 * `undefined` — a freshly uploaded photo then never got attached to the
 * event. Custom routes (register, login, …) don't use that shape and pass through untouched. */
function unwrapDoc<T>(body: unknown): T {
  if (body && typeof body === "object" && "doc" in body && "message" in body) {
    return (body as { doc: T }).doc;
  }
  return body as T;
}

// --- Session expiry -----------------------------------------------------------------

let signedIn = false;
let sessionExpiryHandled = false;

/** Told by AuthContext whether the page believes someone is signed in — only then can a refused
 * request mean that the session ran out underneath it. */
export function setSignedIn(value: boolean) {
  signedIn = value;
}

/**
 * A session lasts two hours (Users.auth.tokenExpiration), renewed only while someone is active
 * (noteActivity), so a page left open past that keeps showing a signed-in app whose every request now fails — Payload answers
 * 403 "not allowed", our own routes 401 — and the user only sees one error toast after another.
 * Either status can also be a genuine refusal, so /users/me decides: only a session that is
 * really gone sends the user to sign in again, with the page to come back to.
 */
// --- Keeping the session alive --------------------------------------------------------

/** Renewed at most this often while someone is active — well inside the two hours a token lasts. */
const REFRESH_EVERY_MS = 20 * 60 * 1000;
let lastRefreshAt = Date.now();
let refreshing = false;

/**
 * Someone is using the page — a request went through, or they typed or clicked. While signed in, the
 * session is renewed now and then (POST /users/refresh-token pushes its end two hours out and sets a
 * fresh cookie), so a form being filled in for a long while doesn't lose its author on "Uložit". A page
 * left alone still runs out — nobody is there to keep it.
 */
export function noteActivity() {
  if (!signedIn || refreshing || sessionExpiryHandled || typeof window === "undefined") return;
  if (Date.now() - lastRefreshAt < REFRESH_EVERY_MS) return;
  refreshing = true;
  void fetch(`${API_BASE}/users/refresh-token`, { method: "POST", credentials: "include" })
    .then((res) => {
      if (res.ok) lastRefreshAt = Date.now();
    })
    .catch(() => undefined)
    .finally(() => {
      refreshing = false;
    });
}

let keepAliveInstalled = false;

/** Typing and clicking count as activity (noteActivity) — filling in a form makes no requests. */
export function installSessionKeepAlive() {
  if (keepAliveInstalled || typeof window === "undefined") return;
  keepAliveInstalled = true;
  for (const type of ["keydown", "pointerdown"] as const) {
    window.addEventListener(type, noteActivity, { passive: true, capture: true });
  }
}

async function handleSessionExpiry(status: number): Promise<void> {
  if (status !== 401 && status !== 403) return;
  if (!signedIn || sessionExpiryHandled || typeof window === "undefined") return;

  const me = await fetch(`${API_BASE}/users/me`, { credentials: "include" })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  // No answer at all says nothing about the session — leave the error to the caller.
  if (!me || me.user) return;

  sessionExpiryHandled = true;
  const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  // Through the logout route, so the dead cookie goes too and the next request starts clean.
  window.location.assign(`/api/auth/logout?reason=expired&redirect=${encodeURIComponent(here)}`);
}

// --- Network failures ------------------------------------------------------------

/** A request gets this long — past it the user is told, rather than left with a spinner for good. */
const REQUEST_TIMEOUT_MS = 30_000;
/** An upload carries a photo over a phone connection — longer. */
const UPLOAD_TIMEOUT_MS = 120_000;

/** Status of a request that never got an answer — offline, timed out, cut off. */
export const NETWORK_ERROR_STATUS = 0;

const OFFLINE_MESSAGE = "Nejste připojeni k internetu. Zkontrolujte připojení a zkuste to znovu.";
const TIMEOUT_MESSAGE = "Server neodpovídá. Zkuste to prosím za chvíli znovu.";
const NETWORK_MESSAGE = "Spojení se serverem se nepodařilo. Zkuste to prosím znovu.";

/** fetch with a time limit, and a Czech message instead of the browser's "Failed to fetch". */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    // The caller cancelled it themselves — theirs to handle, not a network failure.
    if (init.signal?.aborted) throw error;
    if (timeout.aborted) throw new PayloadApiError(TIMEOUT_MESSAGE, NETWORK_ERROR_STATUS);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new PayloadApiError(OFFLINE_MESSAGE, NETWORK_ERROR_STATUS);
    }
    throw new PayloadApiError(NETWORK_MESSAGE, NETWORK_ERROR_STATUS);
  }
}

/** The error a failed answer turns into — the server's own message, or a Czech one by status. */
async function errorOf(res: Response, fallback: string): Promise<PayloadApiError> {
  const body = await res.json().catch(() => null);
  const message =
    body?.errors?.[0]?.message ??
    body?.error ??
    (res.status >= 500 ? "Na serveru se něco pokazilo. Zkuste to prosím znovu." : res.status === 429 ? "Příliš mnoho požadavků. Zkuste to prosím za chvíli." : fallback);
  return new PayloadApiError(message, res.status);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithTimeout(
    `${API_BASE}${path}`,
    {
      credentials: "include",
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    },
    REQUEST_TIMEOUT_MS,
  );

  if (!res.ok) {
    await handleSessionExpiry(res.status);
    throw await errorOf(res, `Požadavek se nezdařil (${res.status}).`);
  }
  noteActivity();

  return unwrapDoc<T>(await res.json());
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export function post<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined });
}

export function patch<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", body: data ? JSON.stringify(data) : undefined });
}

export function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

/** POST a file straight to a Payload upload collection (multipart — no Content-Type header
 * of our own, so the browser sets the multipart boundary itself). Used for the event cover
 * image (brief §4 "Nahrání fotografie k akci"). */
export async function uploadFile<T>(collection: string, file: File, fields?: Record<string, string>): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  // Payload's REST upload convention: every non-file field goes into one "_payload" JSON
  // string field, not as individual form fields (which it 400s on as "missing" instead).
  if (fields && Object.keys(fields).length > 0) {
    form.append("_payload", JSON.stringify(fields));
  }

  const res = await fetchWithTimeout(
    `${API_BASE}/${collection}`,
    { method: "POST", credentials: "include", body: form },
    UPLOAD_TIMEOUT_MS,
  );
  if (!res.ok) {
    await handleSessionExpiry(res.status);
    throw await errorOf(res, `Nahrání se nezdařilo (${res.status}).`);
  }
  noteActivity();
  return unwrapDoc<T>(await res.json());
}

// --- Payload REST `where` query-string helper ---------------------------------------

type WhereOp = "equals" | "not_equals" | "in" | "greater_than" | "less_than" | "exists" | "like";
type WhereClause = Record<string, Partial<Record<WhereOp, unknown>>>;

/** Builds a Payload REST `where[...]` query string, e.g. `where[status][equals]=approved`. */
export function buildWhereParams(where: WhereClause): string {
  const params = new URLSearchParams();
  for (const [field, ops] of Object.entries(where)) {
    for (const [op, value] of Object.entries(ops)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        value.forEach((v) => params.append(`where[${field}][${op}][]`, String(v)));
      } else {
        params.set(`where[${field}][${op}]`, String(value));
      }
    }
  }
  return params.toString();
}

export function buildQuery(parts: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(parts)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.toString();
}

export type PayloadListResponse<T> = {
  docs: T[];
  totalDocs: number;
  limit: number;
  page: number;
  totalPages: number;
};

// --- Auth-adjacent helpers ------------------------------------------------------------

export type PayloadUser = {
  id: number;
  email: string;
  role: "admin" | "user";
};

/** GET /api/users/me — resolves the current session from the payload-token cookie. */
export async function getCurrentPayloadUser(): Promise<PayloadUser | null> {
  try {
    const result = await get<{ user: PayloadUser | null }>("/users/me");
    return result.user ?? null;
  } catch {
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

type RegisterInput = {
  email: string;
  password: string;
  fullName: string;
  /** null together with noMunicipality = "bez obce". */
  municipality: string | null;
  noMunicipality: boolean;
  consentAccepted: boolean;
  /** "Je mi alespoň 15 let" — the server refuses the registration without it. */
  ageConfirmed: boolean;
  marketingConsent: boolean;
  /** Cloudflare Turnstile (components/Turnstile) — omitted where it isn't configured. */
  turnstileToken?: string | null;
};

export async function registerAccount(input: RegisterInput): Promise<{ redirectTo: string }> {
  return post<{ redirectTo: string }>("/auth/register", { ...input, passwordConfirm: input.password });
}

export async function requestPasswordReset(email: string, turnstileToken?: string | null): Promise<void> {
  await post("/auth/forgot-password", { email, ...(turnstileToken ? { turnstileToken } : {}) });
}

/** GET /api/auth/reset-password — whether the emailed link is still unused and unexpired. */
export async function checkResetToken(token: string): Promise<boolean> {
  const { valid } = await get<{ valid: boolean }>(`/auth/reset-password?token=${encodeURIComponent(token)}`);
  return valid;
}

/** POST /api/auth/reset-password — sets a new password from the token in the emailed link. */
export async function resetPasswordWithToken(token: string, password: string): Promise<void> {
  await post("/auth/reset-password", { token, password });
}

/** GET /api/auth/mode — which external sign-in providers are configured. */
export async function getAuthMode(): Promise<{ google: boolean }> {
  try {
    return await get<{ google: boolean }>("/auth/mode");
  } catch {
    return { google: false };
  }
}

/**
 * POST /api/users/login — Payload's own built-in local (email/password) auth, used as a
 * Sets the payload-token cookie our custom auth strategy verifies — the same cookie the Google
 * callback mints, so both sign-in paths end in exactly the same session.
 */
export async function loginWithPassword(
  email: string,
  password: string,
  turnstileToken?: string | null,
): Promise<PayloadUser> {
  const result = await post<{ user: PayloadUser }>("/users/login", {
    email,
    password,
    ...(turnstileToken ? { turnstileToken } : {}),
  });
  return result.user;
}
