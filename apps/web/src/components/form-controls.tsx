'use client';

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label {...props} className={`block text-sm font-medium text-foreground/80 ${props.className ?? ''}`} />
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent ${props.className ?? ''}`}
    />
  );
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent ${props.className ?? ''}`}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent ${props.className ?? ''}`}
    />
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null;
  return <p className="text-sm text-danger">{children}</p>;
}

export function PrimaryButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50 ${className ?? ''}`}
    />
  );
}
