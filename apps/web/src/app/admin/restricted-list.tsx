'use client';

import { useState } from 'react';
import { setAccountStatus, type RestrictedUser } from '@/lib/api';
import { NoteForm } from './note-form';

const dateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });

/** Accounts that are suspended or closed, with the latest decision and a way to reinstate. */
export function RestrictedList({ users, onChanged }: { users: RestrictedUser[]; onChanged: () => Promise<void> }) {
  const [reinstating, setReinstating] = useState<string | null>(null);

  if (users.length === 0) {
    return <p className="mt-4 text-sm text-foreground/60">No suspended or closed accounts.</p>;
  }

  return (
    <ul className="mt-4 flex flex-col gap-3">
      {users.map((u) => (
        <li key={u.id} className="rounded-xl border border-line bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium">{u.name}</p>
              <p className="text-xs text-foreground/50">Trust {u.trustScore}</p>
            </div>
            <span className="shrink-0 rounded-full bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger">
              {u.accountStatus.toLowerCase()}
            </span>
          </div>

          {u.lastDecision && (
            <div className="mt-3 rounded-lg bg-background p-3 text-sm">
              <p className="text-foreground/80">{u.lastDecision.reason}</p>
              <p className="mt-1 text-xs text-foreground/50">
                {u.lastDecision.actor.name} &middot; {dateFormat.format(new Date(u.lastDecision.createdAt))}
              </p>
            </div>
          )}

          {reinstating === u.id ? (
            <NoteForm
              label={`Why is ${u.name} being reinstated?`}
              confirmLabel="Reinstate account"
              onSubmit={async (note) => {
                await setAccountStatus(u.id, { status: 'ACTIVE', reason: note });
                setReinstating(null);
                await onChanged();
              }}
              onCancel={() => setReinstating(null)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setReinstating(u.id)}
              className="mt-3 rounded-full border border-line px-3 py-1.5 text-sm text-foreground/70 hover:border-accent/50 hover:text-foreground"
            >
              Reinstate…
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
