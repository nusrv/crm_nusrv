import { LoginForm } from '../../components/login-form';

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="w-full max-w-md rounded-3xl border border-[var(--line)] bg-white p-8 shadow-sm">
        <div className="mb-8">
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            Internal control panel
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            Authorized staff only. Critical financial and technical actions remain human-controlled.
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
