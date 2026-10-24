'use client';

import { useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api';
import { ErrorText, Label, TextArea } from '@/components/form-controls';

interface NoteFormProps {
  /** What the note is for, e.g. "Why are you suspending them?". */
  label: string;
  confirmLabel: string;
  /** Styles the confirm button as a consequential action. */
  danger?: boolean;
  /** Rejects with an ApiError when the server refuses; resolves when the caller has handled success. */
  onSubmit: (note: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * A required note before any moderation decision. Every decision is recorded
 * with it (resolution on a report, reason in the audit trail), so the button
 * stays disabled until there's something written.
 */
export function NoteForm({ label, confirmLabel, danger = false, onSubmit, onCancel }: NoteFormProps) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = note.trim();
    if (!trimmed || busy) return;
    setError(null);
    setBusy(true);
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that — try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
      <div>
        <Label htmlFor={`note-${confirmLabel}`}>{label}</Label>
        <TextArea
          id={`note-${confirmLabel}`}
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1"
        />
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={busy || !note.trim()}
          className={
            danger
              ? 'rounded-full border border-danger px-4 py-1.5 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50'
              : 'rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50'
          }
        >
          {busy ? 'Saving…' : confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-sm text-foreground/60 underline hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
