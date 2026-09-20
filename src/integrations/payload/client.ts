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
 * `undefined` — a freshly created organization or uploaded photo then never got attached to the
 * event. Custom routes (register, login, …) don't use that shape and pass through untouched. */
function unwrapDoc<T>(body: unknown): T {
  if (body && typeof body === "object" && "doc" in body && "message" in body) {
    return (body as { doc: T }).doc;
  }
  return body as T;
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
    const message = body?.errors?.[0]?.message ?? body?.error ?? `Request failed with status ${res.status}`;
    throw new PayloadApiError(message, res.status);
  }

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
  marketingConsent: boolean;
};

export async function registerAccount(input: RegisterInput): Promise<{ redirectTo: string }> {
  return post<{ redirectTo: string }>("/auth/register", { ...input, passwordConfirm: input.password });
}

export async function requestPasswordReset(email: string): Promise<void> {
  await post("/auth/forgot-password", { email });
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
export async function loginWithPassword(email: string, password: string): Promise<PayloadUser> {
  const result = await post<{ user: PayloadUser }>("/users/login", { email, password });
  return result.user;
}
