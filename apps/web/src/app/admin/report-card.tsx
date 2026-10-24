'use client';

import { useState } from 'react';
import { ApiError, REPORT_REASONS, reviewAdminReport, setAccountStatus, type AdminReport } from '@/lib/api';
import { ErrorText } from '@/components/form-controls';
import { NoteForm } from './note-form';

const dateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });

type Action = 'dismiss' | 'resolve' | 'suspend' | 'ban' | null;

const STATUS_STYLE: Record<AdminReport['status'], string> = {
  OPEN: 'bg-accent-2/10 text-accent-2',
  REVIEWING: 'bg-accent/10 text-accent',
  ACTIONED: 'bg-foreground/5 text-foreground/60',
  DISMISSED: 'bg-foreground/5 text-foreground/60',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One report, with the context to judge it and the decisions a moderator can take. */
export function ReportCard({ report, onChanged }: { report: AdminReport; onChanged: () => Promise<void> }) {
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reasonLabel = REPORT_REASONS.find((r) => r.value === report.reason)?.label ?? report.reason;
  const resolved = report.status === 'ACTIONED' || report.status === 'DISMISSED';
  const alreadyRestricted = report.reported.accountStatus !== 'ACTIVE';
  const { openReportsAgainstThem: open, distinctReportersAgainstThem: people, blockedByCount: blocked } = report.context;

  async function run(work: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await work();
      setAction(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{reasonLabel}</p>
          <p className="mt-0.5 text-xs text-foreground/50">
            {dateFormat.format(new Date(report.createdAt))}
            {report.tripTitle && <> &middot; on {report.tripTitle}</>}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[report.status]}`}>
          {report.status.toLowerCase()}
        </span>
      </div>

      <p className="mt-3 text-sm">
        <span className="font-medium">{report.reporter.name}</span>
        <span className="text-foreground/50"> (trust {report.reporter.trustScore})</span> reported{' '}
        <span className="font-medium">{report.reported.name}</span>
        <span className="text-foreground/50">
          {' '}
          (trust {report.reported.trustScore}
          {alreadyRestricted && <>, {report.reported.accountStatus.toLowerCase()}</>})
        </span>
      </p>

      {report.details && (
        <blockquote className="mt-2 border-l-2 border-line pl-3 text-sm text-foreground/80">{report.details}</blockquote>
      )}

      <p className="mt-3 text-xs text-foreground/60">
        {plural(open, 'open report', 'open reports')} against them from {plural(people, 'person', 'different people')}
        {' · '}
        blocked by {plural(blocked, 'person', 'people')}
      </p>

      {resolved && (
        <div className="mt-3 rounded-lg bg-background p-3 text-sm">
          <p className="text-foreground/80">{report.resolution}</p>
          <p className="mt-1 text-xs text-foreground/50">
            {report.reviewedBy?.name ?? 'A moderator'}
            {report.reviewedAt && <> &middot; {dateFormat.format(new Date(report.reviewedAt))}</>}
          </p>
        </div>
      )}

      <ErrorText>{error}</ErrorText>

      {!resolved && action === null && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {report.status === 'OPEN' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => reviewAdminReport(report.id, { status: 'REVIEWING' }))}
              className="rounded-full border border-line px-3 py-1.5 text-foreground/70 hover:border-accent/50 hover:text-foreground disabled:opacity-50"
            >
              Start review
            </button>
          )}
          <button
            type="button"
            onClick={() => setAction('dismiss')}
            className="rounded-full border border-line px-3 py-1.5 text-foreground/70 hover:border-accent/50 hover:text-foreground"
          >
            Dismiss…
          </button>
          <button
            type="button"
            onClick={() => setAction('resolve')}
            className="rounded-full border border-line px-3 py-1.5 text-foreground/70 hover:border-accent/50 hover:text-foreground"
          >
            Resolve, no account action…
          </button>
          {!alreadyRestricted && (
            <>
              <button
                type="button"
                onClick={() => setAction('suspend')}
                className="rounded-full border border-danger/50 px-3 py-1.5 text-danger hover:bg-danger/10"
              >
                Suspend…
              </button>
              <button
                type="button"
                onClick={() => setAction('ban')}
                className="rounded-full border border-danger/50 px-3 py-1.5 text-danger hover:bg-danger/10"
              >
                Ban…
              </button>
            </>
          )}
        </div>
      )}

      {action === 'dismiss' && (
        <NoteForm
          label="Why is this being dismissed?"
          confirmLabel="Dismiss report"
          onSubmit={(note) => run(() => reviewAdminReport(report.id, { status: 'DISMISSED', resolution: note }))}
          onCancel={() => setAction(null)}
        />
      )}
      {action === 'resolve' && (
        <NoteForm
          label="How was it resolved? (no change to their account)"
          confirmLabel="Mark resolved"
          onSubmit={(note) => run(() => reviewAdminReport(report.id, { status: 'ACTIONED', resolution: note }))}
          onCancel={() => setAction(null)}
        />
      )}
      {(action === 'suspend' || action === 'ban') && (
        <NoteForm
          label={
            action === 'suspend'
              ? `Why suspend ${report.reported.name}? They'll be signed out and unable to sign in. This is recorded.`
              : `Why ban ${report.reported.name}? Their account is closed. This is recorded.`
          }
          confirmLabel={action === 'suspend' ? 'Suspend account' : 'Ban account'}
          danger
          onSubmit={(note) =>
            run(() =>
              setAccountStatus(report.reported.id, {
                status: action === 'suspend' ? 'SUSPENDED' : 'BANNED',
                reason: note,
                reportId: report.id,
              }),
            )
          }
          onCancel={() => setAction(null)}
        />
      )}
    </li>
  );
}
