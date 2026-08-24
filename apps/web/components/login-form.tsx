'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: data.get('email'),
          password: data.get('password'),
          captchaToken: data.get('captchaToken'),
        }),
      });
      const result = (await response.json()) as { mfaRequired?: boolean; message?: string };
      if (!response.ok) throw new Error('Sign-in failed. Check your credentials and CAPTCHA.');
      if (result.mfaRequired) {
        throw new Error(
          'This account requires MFA. MFA verification UI is reserved for the identity phase.',
        );
      }
      router.replace('/dashboard');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <label className="block text-sm font-medium">
        Email
        <input
          className="mt-2 w-full rounded-xl border border-[var(--line)] px-4 py-3 outline-none focus:border-[var(--accent)]"
          name="email"
          type="email"
          autoComplete="username"
          required
        />
      </label>
      <label className="block text-sm font-medium">
        Password
        <input
          className="mt-2 w-full rounded-xl border border-[var(--line)] px-4 py-3 outline-none focus:border-[var(--accent)]"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <label className="block text-sm font-medium">
        CAPTCHA token
        <input
          className="mt-2 w-full rounded-xl border border-[var(--line)] px-4 py-3 outline-none focus:border-[var(--accent)]"
          name="captchaToken"
          type="text"
          autoComplete="off"
          required
        />
        <span className="mt-2 block text-xs font-normal text-[var(--muted)]">
          Phase 0 uses the configured development token. A provider widget can replace this field
          later.
        </span>
      </label>
      {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <button
        className="w-full rounded-xl bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
