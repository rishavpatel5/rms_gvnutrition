import { type ApiErrorBody, type ApiSuccessBody } from "./api-types";

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const RMS_ACCESS_TOKEN_KEY = "rms_access_token";
const RMS_REFRESH_TOKEN_KEY = "rms_refresh_token";

function joinUrl(base: string, path: string): string {
  if (!base) return path;
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Access JWT for authenticated API routes (set by login flow when available). */
export function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(RMS_ACCESS_TOKEN_KEY);
}

export function getStoredRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(RMS_REFRESH_TOKEN_KEY);
}

export function setStoredTokens(accessToken: string, refreshToken: string | null): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(RMS_ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) {
    localStorage.setItem(RMS_REFRESH_TOKEN_KEY, refreshToken);
  }
}

export function clearStoredTokens(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(RMS_ACCESS_TOKEN_KEY);
  localStorage.removeItem(RMS_REFRESH_TOKEN_KEY);
}

type RefreshResponse = {
  user: { id: string; email: string; name: string | null; role: string };
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
};

/** In-flight refresh so parallel 401s share one rotation (server revokes old refresh). */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessTokenOnce(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  const rt = getStoredRefreshToken();
  if (!rt) {
    return false;
  }

  const p = (async (): Promise<boolean> => {
    try {
      const data = await rawPostJson<RefreshResponse>("/api/v1/auth/refresh", {
        refreshToken: rt,
      });
      setStoredTokens(data.tokens.accessToken, data.tokens.refreshToken);
      return true;
    } catch {
      clearStoredTokens();
      return false;
    }
  })();

  refreshInFlight = p;
  try {
    return await p;
  } finally {
    if (refreshInFlight === p) refreshInFlight = null;
  }
}

/** POST JSON without Bearer; used for refresh to avoid circular retry. */
async function rawPostJson<T>(path: string, json: unknown): Promise<T> {
  const base = import.meta.env.VITE_API_URL ?? "";
  const url = joinUrl(base, path);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(json),
  });
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new Error("Invalid JSON response");
    }
  }
  if (!res.ok) {
    const err = body as ApiErrorBody | null;
    const message = err?.error?.message ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return (body as ApiSuccessBody<T>).data;
}

async function fetchJsonEnvelope<T>(
  path: string,
  init?: RequestInit & { auth?: boolean },
  retryAfterRefresh = false,
): Promise<ApiSuccessBody<T>> {
  const { auth, ...rest } = init ?? {};
  const base = import.meta.env.VITE_API_URL ?? "";
  const url = joinUrl(base, path);
  const token = auth ? getStoredAccessToken() : null;
  const method = (rest.method ?? "GET").toString().toUpperCase();
  const hasJsonBody =
    typeof rest.body === "string" &&
    rest.body.length > 0 &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  const res = await fetch(url, {
    ...rest,
    headers: {
      Accept: "application/json",
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...rest.headers,
    },
  });
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new Error("Invalid JSON response");
    }
  }

  if (
    !res.ok &&
    res.status === 401 &&
    auth &&
    !retryAfterRefresh &&
    typeof window !== "undefined"
  ) {
    const refreshed = await refreshAccessTokenOnce();
    if (refreshed) {
      return fetchJsonEnvelope<T>(path, init, true);
    }
  }

  if (!res.ok) {
    const err = body as ApiErrorBody | null;
    const message = err?.error?.message ?? `Request failed (${res.status})`;
    throw new Error(message);
  }

  if (res.status === 204) {
    return { data: undefined as T };
  }

  return body as ApiSuccessBody<T>;
}

export async function apiGetJson<T>(path: string, init?: RequestInit): Promise<T> {
  const body = await fetchJsonEnvelope<T>(path, { ...init, auth: false });
  return body.data;
}

/** GET with Bearer token when `rms_access_token` is present in localStorage. */
export async function apiGetJsonAuthed<T>(path: string, init?: RequestInit): Promise<T> {
  const body = await fetchJsonEnvelope<T>(path, { ...init, auth: true });
  return body.data;
}

export async function apiGetJsonAuthedWithMeta<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T; meta?: PaginationMeta }> {
  const body = await fetchJsonEnvelope<T>(path, { ...init, auth: true });
  return {
    data: body.data,
    meta: body.meta as PaginationMeta | undefined,
  };
}

export async function apiPostJson<T>(path: string, json: unknown, init?: RequestInit): Promise<T> {
  const body = await fetchJsonEnvelope<T>(path, {
    ...init,
    method: "POST",
    body: JSON.stringify(json),
    auth: false,
  });
  return body.data;
}

export async function apiPostJsonAuthed<T>(
  path: string,
  json: unknown,
  init?: RequestInit,
): Promise<T> {
  const body = await fetchJsonEnvelope<T>(path, {
    ...init,
    method: "POST",
    body: JSON.stringify(json),
    auth: true,
  });
  return body.data;
}

export async function apiPatchJsonAuthed<T>(
  path: string,
  json: unknown,
  init?: RequestInit,
): Promise<T> {
  const body = await fetchJsonEnvelope<T>(path, {
    ...init,
    method: "PATCH",
    body: JSON.stringify(json),
    auth: true,
  });
  return body.data;
}

export async function apiDeleteAuthed(path: string, init?: RequestInit): Promise<void> {
  await fetchJsonEnvelope<unknown>(path, {
    ...init,
    method: "DELETE",
    auth: true,
  });
}

/** DELETE for endpoints that report what they did in the response body. */
export async function apiDeleteJsonAuthed<T>(path: string, init?: RequestInit): Promise<T> {
  const body = await fetchJsonEnvelope<T>(path, {
    ...init,
    method: "DELETE",
    auth: true,
  });
  return body.data;
}
