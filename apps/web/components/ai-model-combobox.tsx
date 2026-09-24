'use client';

import { useEffect, useId, useRef, useState } from 'react';

export interface AiModelOption {
  id: string;
  displayName: string;
  compatibility: 'COMPATIBLE' | 'UNKNOWN';
}

/**
 * Dynamic model discovery ("n8n-style" UX correction) — a searchable selector over an already
 * fully-loaded, client-side model list (unlike CustomerCombobox, which searches the server per
 * keystroke; a discovered model list is bounded and already in memory, so filtering locally is both
 * simpler and correct). The exact `id` is what a caller stores/sends — `displayName` is presentation
 * only. No hard-coded result limit: every match that passes the search filter is rendered in a
 * scrollable list.
 */
export function AiModelCombobox({
  options,
  value,
  onSelect,
  disabled,
  placeholder,
}: {
  options: AiModelOption[];
  value: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const selectedOption = options.find((option) => option.id === value);
  const displayValue = open ? search : (selectedOption?.displayName ?? '');
  const query = search.trim().toLowerCase();
  const filtered = query
    ? options.filter((option) => option.id.toLowerCase().includes(query) || option.displayName.toLowerCase().includes(query))
    : options;

  return (
    <div className="field relative" ref={containerRef}>
      <span>Model</span>
      <input
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open}
        autoComplete="off"
        disabled={disabled}
        onChange={(event) => {
          setSearch(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'Enter') event.preventDefault();
        }}
        placeholder={placeholder ?? 'Search models…'}
        role="combobox"
        value={displayValue}
      />
      {open && (
        <div
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-[var(--line)] bg-white shadow-sm"
          id={listboxId}
          role="listbox"
          style={{ top: '100%' }}
        >
          {!filtered.length && <p className="muted p-3 text-sm">No models match.</p>}
          {filtered.map((option) => (
            <button
              aria-selected={option.id === value}
              className={`block w-full border-b border-[var(--line)] p-3 text-left text-sm last:border-b-0 hover:bg-[var(--surface)] ${
                option.id === value ? 'bg-[var(--accent-soft)]' : ''
              }`}
              key={option.id}
              onClick={() => {
                onSelect(option.id);
                setSearch('');
                setOpen(false);
              }}
              role="option"
              type="button"
            >
              <strong>{option.displayName}</strong>
              {option.displayName !== option.id && <span className="muted text-xs"> · {option.id}</span>}
              {option.compatibility === 'UNKNOWN' && <span className="muted text-xs"> · compatibility unknown, verify with Test AI</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
