'use client';

import { useEffect, useState } from 'react';
import { ApiError, listBlockedUsers, unblockUser, type BlockedUser } from '@/lib/api';
import { ErrorText } from '@/components/form-controls';

/** The people you've blocked, with a way to undo it. Never shows who has blocked you. */
export function BlockedPeople() {
  const [blocked, setBlocked] = useState<BlockedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    listBlockedUsers()
      .then(setBlocked)
      .catch(() => setError('Could not load the people you have blocked.'));
  }, []);

  async function handleUnblock(userId: string) {
    setError(null);
    setBusyId(userId);
    try {
      await unblockUser(userId);
      setBlocked((prev) => (prev ?? []).filter((b) => b.user.id !== userId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not unblock — try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-12">
      <h2 className="text-lg font-semibold tracking-tight">Blocked people</h2>
      <p className="mt-1 text-sm text-foreground/60">
        You and anyone you block don&apos;t see each other in discovery, on trip pages, in travellers lists or in chat.
        They aren&apos;t told. You can block someone from a trip you share.
      </p>

      <div className="mt-3">
        <ErrorText>{error}</ErrorText>
        {!error && blocked === null && <p className="text-sm text-foreground/60">Loading…</p>}
        {blocked !== null && blocked.length === 0 && (
          <p className="text-sm text-foreground/60">You haven&apos;t blocked anyone.</p>
        )}
        {blocked !== null && blocked.length > 0 && (
          <ul className="flex flex-col gap-2">
            {blocked.map((b) => (
              <li
                key={b.user.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm"
              >
                <span>{b.user.name}</span>
                <button
                  type="button"
                  onClick={() => handleUnblock(b.user.id)}
                  disabled={busyId === b.user.id}
                  className="text-xs text-foreground/60 underline hover:text-foreground disabled:opacity-50"
                >
                  {busyId === b.user.id ? 'Unblocking…' : 'Unblock'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
