'use client';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
let refreshInFlight: Promise<boolean> | undefined;
let logoutInFlight: Promise<Response> | undefined;
let sessionGeneration = 0;
let refreshGeneration = 0;

function refreshSession(): Promise<boolean> {
  const currentSession = sessionGeneration;
  refreshInFlight ??= fetch(`${apiUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
  }).then((response) => {
    if (!response.ok || currentSession !== sessionGeneration || logoutInFlight) return false;
    refreshGeneration += 1;
    return true;
  }).catch(() => false).finally(() => { refreshInFlight = undefined; });
  return refreshInFlight;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const sessionEndpoint = /^\/auth\/(login|logout|refresh)(?:\?|$)/.test(path);
  const logout = /^\/auth\/logout(?:\?|$)/.test(path);
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const request = () => fetch(`${apiUrl}/api/v1${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers,
  });
  const requestGeneration = sessionGeneration;
  const initialRefresh = refreshGeneration;
  const checkSession = () => {
    if (!sessionEndpoint && (logoutInFlight || requestGeneration !== sessionGeneration)) {
      throw new Error('Authentication required.');
    }
  };
  checkSession();
  if (logout && !logoutInFlight) {
    sessionGeneration += 1;
    logoutInFlight = request().finally(() => { logoutInFlight = undefined; });
  }
  let response = await (logoutInFlight && logout ? logoutInFlight : request());
  checkSession();
  // A successful refresh can satisfy another request's late 401 without a second refresh.
  if (response.status === 401 && !sessionEndpoint) {
    const restored = initialRefresh !== refreshGeneration || await refreshSession();
    checkSession();
    if (restored) response = await request();
    checkSession();
  }
  if (response.status === 401) throw new Error('Authentication required.');
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message) ? body.message.join(' ') : (body.message ?? message);
    } catch {
      // The fallback status message is intentionally safe.
    }
    checkSession();
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json()) as T;
  checkSession();
  return body;
}

export interface PageResult<T> {
  data: T[];
  meta: { total: number; page: number; pageSize: number; pageCount: number };
}
