'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRequireAuth } from '@/lib/use-require-auth';
import {
  ApiError,
  listAdminReports,
  listRestrictedUsers,
  type AdminReport,
  type RestrictedUser,
} from '@/lib/api';
import { ErrorText } from '@/components/form-controls';
import { ReportCard } from './report-card';
import { RestrictedList } from './restricted-list';

type Tab = 'open' | 'resolved' | 'restricted';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'open', label: 'Open reports' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'restricted', label: 'Restricted accounts' },
];

/**
 * The moderation console. Admin-only: the API refuses everyone else, and this
 * page just doesn't pretend otherwise. Every decision here is a person's; the
 * app takes no automatic action on reports.
 */
export default function AdminPage() {
  const authStatus = useRequireAuth();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [tab, setTab] = useState<Tab>('open');
  const [open, setOpen] = useState<AdminReport[] | null>(null);
  const [resolved, setResolved] = useState<AdminReport[] | null>(null);
  const [restricted, setRestricted] = useState<RestrictedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [queue, actioned, dismissed, restrictedUsers] = await Promise.all([
        listAdminReports(),
        listAdminReports('ACTIONED'),
        listAdminReports('DISMISSED'),
        listRestrictedUsers(),
      ]);
      setOpen(queue);
      // History is both closed outcomes together, newest decision first.
      setResolved(
        [...actioned, ...dismissed].sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? '')),
      );
      setRestricted(restrictedUsers);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the moderation queue.');
    }
  }, []);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !isAdmin) return;
    // Deferred a microtask so setState inside load() never happens
    // synchronously within the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => load());
  }, [authStatus, isAdmin, load]);

  if (authStatus !== 'authenticated' || !user) return null;

  if (!isAdmin) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-[0.95rem] text-muted">This page is for admins.</p>
      </main>
    );
  }

  const counts: Record<Tab, number | null> = {
    open: open?.length ?? null,
    resolved: resolved?.length ?? null,
    restricted: restricted?.length ?? null,
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Moderation</h1>
      <p className="mt-1 text-[0.95rem] text-muted">
        Reports are read by people — nothing here happens automatically. Every decision needs a note and is recorded.
      </p>

      <div role="tablist" className="mt-6 flex gap-2 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-[0.95rem] transition ${
              tab === t.id
                ? 'border-accent text-foreground'
                : 'border-transparent text-muted hover:text-foreground'
            }`}
          >
            {t.label}
            {counts[t.id] !== null && <span className="ml-1.5 text-[0.85rem] text-muted">{counts[t.id]}</span>}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <ErrorText>{error}</ErrorText>
      </div>

      {tab === 'open' &&
        (open === null ? (
          !error && <p className="text-[0.95rem] text-muted">Loading…</p>
        ) : open.length === 0 ? (
          <p className="text-[0.95rem] text-muted">No open reports. Nothing is waiting on you.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {open.map((r) => (
              <ReportCard key={r.id} report={r} onChanged={load} />
            ))}
          </ul>
        ))}

      {tab === 'resolved' &&
        (resolved === null ? (
          !error && <p className="text-[0.95rem] text-muted">Loading…</p>
        ) : resolved.length === 0 ? (
          <p className="text-[0.95rem] text-muted">Nothing resolved yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {resolved.map((r) => (
              <ReportCard key={r.id} report={r} onChanged={load} />
            ))}
          </ul>
        ))}

      {tab === 'restricted' &&
        (restricted === null ? (
          !error && <p className="text-[0.95rem] text-muted">Loading…</p>
        ) : (
          <RestrictedList users={restricted} onChanged={load} />
        ))}
    </main>
  );
}
