'use client';

import { createContext, useContext, useId } from 'react';

const ModalDepth = createContext(0);

/** Explicit dismissal only. Save is owned by the form, never by this shell.
 * Nested overlays preserve the mounted parent and therefore its form/filter state. */
export function Modal({
  title, onClose, children, maxWidth = '40rem', closeDisabled = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
  closeDisabled?: boolean;
}) {
  const depth = useContext(ModalDepth);
  const titleId = useId();
  return (
    <ModalDepth.Provider value={depth + 1}>
      <div style={{ position: 'fixed', inset: 0, zIndex: 60 + depth, overflowY: 'auto', background: 'rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', minHeight: '100%', alignItems: 'flex-start', justifyContent: 'center', padding: '2.5rem 1rem' }}>
          <section aria-labelledby={titleId} aria-modal="true" role="dialog" className="panel" style={{ width: '100%', maxWidth }}>
            <div className="flex justify-between gap-4">
              <h3 id={titleId} className="text-lg font-semibold">{title}</h3>
              <button aria-label="Close dialog" className="button-secondary" disabled={closeDisabled} onClick={onClose} type="button">×</button>
            </div>
            <div className="mt-5">{children}</div>
            <div className="mt-5 flex justify-end border-t border-[var(--line)] pt-4">
              <button className="button-secondary" disabled={closeDisabled} onClick={onClose} type="button">Close</button>
            </div>
          </section>
        </div>
      </div>
    </ModalDepth.Provider>
  );
}
