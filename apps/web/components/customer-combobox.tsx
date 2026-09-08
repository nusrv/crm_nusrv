'use client';

import { useEffect, useId, useRef, useState } from 'react';

export interface CustomerComboboxOption {
  id: string;
  customerCode: string;
  companyName: string;
  primaryEmail?: string | null;
}

function optionLabel(option: CustomerComboboxOption) {
  return option.companyName;
}

export function CustomerCombobox({
  options,
  value,
  onSelect,
  searchValue,
  onSearchChange,
  selectedLabel,
  loading,
  placeholder,
  required,
}: {
  options: CustomerComboboxOption[];
  value: string;
  onSelect: (id: string, label: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  selectedLabel?: string;
  loading?: boolean;
  placeholder?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const displayValue = open ? searchValue : (selectedLabel ?? searchValue);

  return (
    <div className="field relative" ref={containerRef}>
      <span>Existing customer</span>
      <input
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-required={required}
        autoComplete="off"
        onChange={(event) => {
          onSearchChange(event.target.value);
          onSelect('', '');
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'Enter') event.preventDefault();
        }}
        placeholder={placeholder ?? 'Search company name, code, or email…'}
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
          {loading && <p className="muted p-3 text-sm">Searching…</p>}
          {!loading && !options.length && <p className="muted p-3 text-sm">No customers found.</p>}
          {!loading &&
            options.map((option) => (
              <button
                aria-selected={option.id === value}
                className={`block w-full border-b border-[var(--line)] p-3 text-left text-sm last:border-b-0 hover:bg-[var(--surface)] ${
                  option.id === value ? 'bg-[var(--accent-soft)]' : ''
                }`}
                key={option.id}
                onClick={() => {
                  onSelect(option.id, optionLabel(option));
                  onSearchChange(optionLabel(option));
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                <strong>{option.companyName}</strong>
                {option.primaryEmail && (
                  <>
                    <br />
                    <span className="muted text-xs">{option.primaryEmail}</span>
                  </>
                )}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
