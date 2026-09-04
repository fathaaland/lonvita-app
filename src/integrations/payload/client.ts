/**
 * Thin REST client for the Payload backend, replacing the old Supabase client. Frontend
 * and backend are the same Next.js app, so this always calls same-origin — no CORS or
 * SameSite gymnastics needed for cookies (Auth0 session, payload-token).
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
    const message = body?.errors?.[0]?.message ?? `Request failed with status ${res.status}`;
    throw new PayloadApiError(message, res.status);
  }

  return res.json() as Promise<T>;
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
  return res.json() as Promise<T>;
}

// --- Payload REST `where` query-string helper ---------------------------------------

type WhereOp = "equals" | "not_equals" | "in" | "greater_than" | "less_than" | "exists";
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

/** GET /api/users/me — resolves the current session (payload-token or Auth0-session-bridged). */
export async function getCurrentPayloadUser(): Promise<PayloadUser | null> {
  try {
    const result = await get<{ user: PayloadUser | null }>("/users/me");
    return result.user ?? null;
  } catch {
    return null;
  }
}

/** Redirects the browser to Payload's Auth0-backed logout route. */
export function signOutRedirect() {
  window.location.href = "/api/auth/logout";
}

/**
 * Redirects the browser into the Auth0 SDK's hosted login flow. `returnTo` is where the
 * /api/auth/complete bridge route sends the browser back to afterwards (a relative path
 * within this app). `connection`/`loginHint` are forwarded to Auth0 as authorization params
 * (e.g. connection="google-oauth2" to skip straight to Google, loginHint to prefill email).
 */
export function redirectToLogin(options?: { returnTo?: string; connection?: string; loginHint?: string }) {
  const complete = new URLSearchParams();
  complete.set("returnTo", options?.returnTo ?? "/");

  const login = new URLSearchParams();
  login.set("returnTo", `/api/auth/complete?${complete.toString()}`);
  if (options?.connection) login.set("connection", options.connection);
  if (options?.loginHint) login.set("login_hint", options.loginHint);

  window.location.href = `/auth/login?${login.toString()}`;
}

type RegisterInput = {
  email: string;
  password: string;
  fullName: string;
  municipality: string;
  consentAccepted: boolean;
  marketingConsent: boolean;
};

export async function registerAccount(input: RegisterInput): Promise<{ redirectTo: string }> {
  return post<{ redirectTo: string }>("/auth/register", { ...input, passwordConfirm: input.password });
}

export async function requestPasswordReset(email: string): Promise<void> {
  await post("/auth/forgot-password", { email });
}

/** GET /api/auth/mode — whether Auth0 is configured, or the app is running on the fallback. */
export async function getAuthMode(): Promise<{ auth0: boolean }> {
  try {
    return await get<{ auth0: boolean }>("/auth/mode");
  } catch {
    return { auth0: false };
  }
}

/**
 * POST /api/users/login — Payload's own built-in local (email/password) auth, used as a
 * fallback while no Auth0 tenant is configured. Sets the same payload-token cookie our
 * custom auth strategy already knows how to verify, so nothing else needs to change.
 */
export async function loginWithPassword(email: string, password: string): Promise<PayloadUser> {
  const result = await post<{ user: PayloadUser }>("/users/login", { email, password });
  return result.user;
}

/** POST /api/users/forgot-password — Payload's own reset-email flow (fallback, no Auth0). */
export async function requestNativePasswordReset(email: string): Promise<void> {
  await post("/users/forgot-password", { email });
}
