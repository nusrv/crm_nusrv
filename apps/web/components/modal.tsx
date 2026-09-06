'use client';

// Shared modal overlay used by every "create/edit" form in the Control Panel, so an edit action
// never pushes the current page's content down — it always opens on top of it instead. Uses
// inline styles rather than Tailwind utility classes, matching the pattern already established
// for apps/web/components/legacy-import-manager.tsx's row-inspector overlay, since arbitrary-value
// Tailwind classes for a full-screen overlay have previously been dropped by production CSS
// purging.

export function Modal({
  title,
  onClose,
  children,
  maxWidth = '40rem',
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        overflowY: 'auto',
        background: 'rgba(0,0,0,0.6)',
      }}
    >
      <div
        style={{
          display: 'flex',
          minHeight: '100%',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '2.5rem 1rem',
        }}
      >
        <section className="panel" style={{ width: '100%', maxWidth }}>
          <div className="flex justify-between gap-4">
            <h3 className="text-lg font-semibold">{title}</h3>
            <button className="button-secondary" onClick={onClose} type="button">
              Close
            </button>
          </div>
          <div className="mt-5">{children}</div>
        </section>
      </div>
    </div>
  );
}
