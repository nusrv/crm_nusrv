'use client';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const response = await fetch(`${apiUrl}/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: isForm ? init.headers : { 'Content-Type': 'application/json', ...init.headers },
  });
  if (response.status === 401) throw new Error('Authentication required.');
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message) ? body.message.join(' ') : (body.message ?? message);
    } catch {
      // The fallback status message is intentionally safe.
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface PageResult<T> {
  data: T[];
  meta: { total: number; page: number; pageSize: number; pageCount: number };
}
