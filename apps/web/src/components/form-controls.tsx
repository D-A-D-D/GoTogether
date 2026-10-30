'use client';

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { Button } from '@/components/ui';

// Inputs are 48px tall and 17px type: big enough to hit and to read, and the type size is also what keeps
// iOS from zooming the page when a field is focused. The border is the --field colour, which is measured
// to be visible (3:1) against the field's own background - a pale hairline is not enough to find a box by.
const FIELD =
  'w-full rounded-xl border border-field bg-surface px-4 text-base text-foreground placeholder:text-muted outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-60';

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={`block text-[0.95rem] font-semibold text-foreground ${props.className ?? ''}`} />;
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD} h-12 ${props.className ?? ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${FIELD} min-h-28 py-3 ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${FIELD} h-12 ${props.className ?? ''}`} />;
}

export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger/10 px-4 py-2.5 text-[0.95rem] font-medium text-danger">
      {children}
    </p>
  );
}

// A width in the caller's className (w-fit, w-auto, w-40 ...) means it chose one; otherwise a primary
// button fills its container, as the form buttons always have. Both used to be applied together, and
// whichever Tailwind emitted last won - which is how a "Send" button once swallowed a whole chat row.
const CHOSE_WIDTH = /(^|\s)w-(fit|auto|full|min|max|\d|\[|\d\/\d)/;

export function PrimaryButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const chose = CHOSE_WIDTH.test(className ?? '');
  return <Button {...props} type={props.type ?? 'button'} block={!chose} className={className} />;
}
