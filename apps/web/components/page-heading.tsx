export function PageHeading({
  eyebrow = 'Phase 2',
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
          {eyebrow}
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">{description}</p>
      </div>
      {actions}
    </header>
  );
}
