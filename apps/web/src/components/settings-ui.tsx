'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconChevronRight } from '@/components/icons';

/** A titled group of settings, as one card with rows divided by hairlines. */
export function SettingsSection({ title, children, footnote }: { title: string; children: ReactNode; footnote?: ReactNode }) {
  return (
    <section className="mt-7" aria-label={title}>
      <h2 className="mb-2 px-1 text-[0.95rem] font-bold uppercase tracking-wide text-muted">{title}</h2>
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">{children}</div>
      {footnote && <p className="mt-2 px-1 text-[0.9rem] text-muted">{footnote}</p>}
    </section>
  );
}

function RowBody({ icon, label, description, trailing }: { icon?: ReactNode; label: string; description?: string; trailing?: ReactNode }) {
  return (
    <>
      {icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-snug">{label}</span>
        {description && <span className="mt-0.5 block text-[0.9rem] leading-snug text-muted">{description}</span>}
      </span>
      {trailing}
    </>
  );
}

/** A row that opens another screen. */
export function SettingsLink({ href, icon, label, description }: { href: string; icon?: ReactNode; label: string; description?: string }) {
  return (
    <Link href={href} className="pressable flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-2/60">
      <RowBody icon={icon} label={label} description={description} trailing={<IconChevronRight size={20} className="shrink-0 text-muted" />} />
    </Link>
  );
}

/**
 * An on/off switch. A real button with role "switch", so a screen reader says what it is and whether it is on;
 * and a track 56px wide, because a switch is a small thing to hit with a thumb.
 */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`pressable relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-field/60'}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-[1.75rem]' : 'left-1'}`}
      />
    </button>
  );
}

/** A row with a switch on it. */
export function SettingsToggle({
  icon,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  icon?: ReactNode;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-16 items-center gap-3 px-4 py-3">
      <RowBody icon={icon} label={label} description={description} trailing={<Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />} />
    </div>
  );
}

/** Pick one of a few: a row of large buttons, one pressed. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (next: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1.5 rounded-2xl bg-surface-2 p-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`pressable flex min-h-12 items-center justify-center gap-1.5 rounded-xl px-2 text-center text-[0.95rem] font-semibold leading-tight transition ${
              selected ? 'bg-surface text-foreground shadow-card ring-2 ring-accent' : 'text-muted hover:text-foreground'
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
