'use client';

import { useEffect, useState } from 'react';
import { ApiError, listBlockedUsers, unblockUser, type BlockedUser } from '@/lib/api';
import { ErrorText } from '@/components/form-controls';

/**
 * The people you've blocked, with a way to undo it. Never shows who has blocked you.
 * `standalone` is for a page that already carries the title: no heading, no margin made for sitting below other content.
 */
export function BlockedPeople({ standalone = false }: { standalone?: boolean }) {
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
    <section className={standalone ? undefined : 'mt-12'}>
      {!standalone && <h2 className="text-xl font-bold">Blocked people</h2>}
      <p className={`text-[0.95rem] text-muted ${standalone ? '' : 'mt-1'}`}>
        You and anyone you block don&apos;t see each other in discovery, on trip pages, in travellers lists or in chat.
        They aren&apos;t told, and any private chat between you is deleted. You can block someone from a trip you share.
      </p>

      <div className="mt-3">
        <ErrorText>{error}</ErrorText>
        {!error && blocked === null && <p className="text-[0.95rem] text-muted">Loading…</p>}
        {blocked !== null && blocked.length === 0 && (
          <p className="text-[0.95rem] text-muted">You haven&apos;t blocked anyone.</p>
        )}
        {blocked !== null && blocked.length > 0 && (
          <ul className="flex flex-col gap-2">
            {blocked.map((b) => (
              <li
                key={b.user.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface shadow-card px-4 py-3 text-[0.95rem]"
              >
                <span>{b.user.name}</span>
                <button
                  type="button"
                  onClick={() => handleUnblock(b.user.id)}
                  disabled={busyId === b.user.id}
                  className="inline-flex min-h-11 items-center px-2 text-[0.95rem] font-semibold text-accent-ink underline-offset-4 hover:underline disabled:opacity-50"
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
