import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { coverFor, hashString } from '@/lib/cover';

/* ---- Buttons ----------------------------------------------------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'btn-shadow bg-accent text-on-accent hover:brightness-110 disabled:opacity-50 disabled:shadow-none',
  secondary: 'border border-field bg-surface text-foreground hover:bg-surface-2 disabled:opacity-50',
  ghost: 'text-foreground hover:bg-surface-2 disabled:opacity-50',
  danger: 'border border-danger text-danger hover:bg-danger/10 disabled:opacity-50',
};
// 48px is the default height: comfortably above the 44px that platform guidelines ask of a touch target.
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-10 px-4 text-[0.95rem]',
  md: 'h-12 px-6 text-base',
  lg: 'h-14 px-8 text-lg',
};

/** The classes for a button-looking thing, so links can look like buttons without being nested in them. */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', block = false): string {
  return [
    'pressable inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold',
    'disabled:cursor-not-allowed',
    VARIANT[variant],
    SIZE[size],
    block ? 'w-full' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width of its container. Off by default: a button is as wide as its label needs. */
  block?: boolean;
}

export function Button({ variant, size, block, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} {...rest} className={`${buttonClasses(variant, size, block)} ${className ?? ''}`} />;
}

interface ButtonLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

export function ButtonLink({ variant, size, block, className, href, ...rest }: ButtonLinkProps) {
  return <Link href={href} {...rest} className={`${buttonClasses(variant, size, block)} ${className ?? ''}`} />;
}

/** A round icon-only button. The label is required: with no text on it, it is all a screen reader has. */
export function IconButton({
  label,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      {...rest}
      className={`pressable inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-surface-2 disabled:opacity-50 ${className ?? ''}`}
    >
      {children}
    </button>
  );
}

/* ---- Surfaces ---------------------------------------------------------------------------- */

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={`rounded-2xl border border-line bg-surface shadow-card ${className ?? ''}`} />;
}

export function Chip({ children, tone = 'plain', className }: { children: ReactNode; tone?: 'plain' | 'accent' | 'gold'; className?: string }) {
  const tones = {
    plain: 'bg-surface-2 text-foreground',
    accent: 'bg-accent-soft text-accent-ink',
    gold: 'bg-gold text-on-gold',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[0.9rem] font-medium ${tones[tone]} ${className ?? ''}`}>
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className ?? ''}`} />;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-field px-6 py-12 text-center">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children && <p className="max-w-sm text-muted">{children}</p>}
      {action}
    </div>
  );
}

/* ---- People ------------------------------------------------------------------------------ */

// Background / text pairs, each checked at 4.5:1 or better.
const AVATAR_TONES = [
  ['#0B4B45', '#FFF1DE'],
  ['#D23A14', '#FFFFFF'],
  ['#FFB41F', '#0A2F2C'],
  ['#7B1D3A', '#FFE3EA'],
  ['#0B7D6E', '#FFFFFF'],
  ['#FFE8CF', '#0A2F2C'],
] as const;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** A person with no photo yet: their initials on a colour that is always the same for them. */
export function Avatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  const [bg, fg] = AVATAR_TONES[hashString(name) % AVATAR_TONES.length];
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-display font-semibold ${className ?? ''}`}
      style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.round(size * 0.38) }}
    >
      {initialsOf(name)}
    </span>
  );
}

/* ---- Covers ------------------------------------------------------------------------------ */

/**
 * The picture for a trip: its own photo if it has one, otherwise a gradient with contour lines
 * drawn from its name. Children sit over the bottom-left, on a scrim that keeps white text legible.
 */
export function TripCover({
  seed,
  photoUrl,
  className,
  children,
}: {
  seed: string;
  photoUrl?: string | null;
  className?: string;
  children?: ReactNode;
}) {
  const cover = coverFor(seed);
  return (
    <div
      className={`relative isolate overflow-hidden text-white ${className ?? ''}`}
      style={photoUrl ? { background: `center / cover url(${JSON.stringify(photoUrl)}), ${cover.background}` } : { background: cover.background }}
    >
      {!photoUrl && (
        <svg
          aria-hidden="true"
          className="absolute inset-0 -z-10 h-full w-full opacity-30"
          viewBox="0 0 400 240"
          preserveAspectRatio="xMidYMid slice"
          fill="none"
          stroke="#fff"
          strokeWidth="1.1"
        >
          {cover.contours.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </svg>
      )}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
      {children}
    </div>
  );
}
