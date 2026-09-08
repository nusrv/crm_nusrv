'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  customerCombinedLabel,
  customerDisplayName,
  customerSecondaryName,
} from '../lib/customer-name';

export interface CustomerComboboxOption {
  id: string;
  customerCode: string;
  nameEn?: string | null;
  nameAr?: string | null;
  primaryEmail?: string | null;
}

// The compact label shown once a customer is selected (and typed back into the search box while
// closed). Similarly-named customers are common — under different Billing Entities on purpose —
// so lead with the Customer Code and include the email when available, not just the name.
function optionLabel(option: CustomerComboboxOption) {
  const parts = [option.customerCode, customerCombinedLabel(option), option.primaryEmail].filter(
    (part): part is string => Boolean(part),
  );
  return parts.join(' · ');
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
                <strong>{customerDisplayName(option)}</strong>
                <span className="muted text-xs"> · {option.customerCode}</span>
                {customerSecondaryName(option) && (
                  <>
                    <br />
                    <span className="muted text-xs" dir="auto">
                      {customerSecondaryName(option)}
                    </span>
                  </>
                )}
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
