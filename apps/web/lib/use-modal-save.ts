'use client';

import { useRef, useState } from 'react';

/** Keep the dialog mounted after a mutation. A synchronous lock also rejects
 * a second submit before React has rendered the disabled controls. */
export function useModalSave() {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  function begin() {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    return true;
  }
  function markSaved() { setRevision(value => value + 1); }
  function finish() {
    locked.current = false;
    setBusy(false);
  }
  return { busy, revision, begin, markSaved, finish };
}
