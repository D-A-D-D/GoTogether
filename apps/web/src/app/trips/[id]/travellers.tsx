'use client';

import { useState, type FormEvent } from 'react';
import {
  ApiError,
  REPORT_REASONS,
  blockUser,
  reportUser,
  type ReportReason,
  type TripMember,
} from '@/lib/api';
import { ErrorText, Label, PrimaryButton, Select, TextArea } from '@/components/form-controls';

interface TravellersProps {
  tripId: string;
  members: TripMember[];
  meId: string;
  /** Called after a block, so the list reloads without the person just blocked. */
  onChanged: () => Promise<void>;
}

type Panel = { userId: string; kind: 'report' | 'block' } | null;

/**
 * Who's on the trip, with Report and Block for each person. Only shown to
 * people on the trip (the API refuses anyone else). Blocked people never
 * appear here, in either direction.
 */
export function Travellers({ tripId, members, meId, onChanged }: TravellersProps) {
  const [panel, setPanel] = useState<Panel>(null);
  const [reported, setReported] = useState<Set<string>>(new Set());

  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Travellers</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {members.map((m) => {
          const isMe = m.userId === meId;
          const open = panel?.userId === m.userId ? panel.kind : null;
          return (
            <li key={m.userId} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="font-medium">{m.user.name}</span>
                  {isMe && <span className="text-foreground/50"> (you)</span>}
                  {m.role === 'HOST' && (
                    <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">Host</span>
                  )}
                  <span className="ml-2 text-xs text-foreground/50">Trust {m.user.trustScore}</span>
                </div>
                {!isMe && open === null && (
                  <div className="flex shrink-0 gap-3 text-xs">
                    {reported.has(m.userId) ? (
                      <span className="text-foreground/50">Reported</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPanel({ userId: m.userId, kind: 'report' })}
                        className="text-foreground/60 underline hover:text-foreground"
                      >
                        Report
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPanel({ userId: m.userId, kind: 'block' })}
                      className="text-foreground/60 underline hover:text-danger"
                    >
                      Block
                    </button>
                  </div>
                )}
              </div>

              {open === 'report' && (
                <ReportForm
                  tripId={tripId}
                  member={m}
                  onDone={() => {
                    setReported((prev) => new Set(prev).add(m.userId));
                    setPanel(null);
                  }}
                  onCancel={() => setPanel(null)}
                />
              )}
              {open === 'block' && (
                <BlockConfirm
                  member={m}
                  onDone={async () => {
                    setPanel(null);
                    await onChanged();
                  }}
                  onCancel={() => setPanel(null)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ReportForm({
  tripId,
  member,
  onDone,
  onCancel,
}: {
  tripId: string;
  member: TripMember;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<ReportReason>('HARASSMENT');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await reportUser({
        reportedId: member.userId,
        reason,
        tripId,
        ...(details.trim() ? { details: details.trim() } : {}),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the report — try again.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
      <p className="text-xs text-foreground/60">
        Reports are read by people, not acted on automatically. {member.user.name} isn&apos;t told who reported them.
      </p>
      <div>
        <Label htmlFor={`report-reason-${member.userId}`}>What happened?</Label>
        <Select
          id={`report-reason-${member.userId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value as ReportReason)}
          className="mt-1"
        >
          {REPORT_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`report-details-${member.userId}`}>Anything else we should know? (optional)</Label>
        <TextArea
          id={`report-details-${member.userId}`}
          rows={3}
          maxLength={2000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          className="mt-1"
        />
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="flex items-center gap-4">
        <PrimaryButton type="submit" disabled={submitting} className="w-fit px-5">
          {submitting ? 'Sending…' : 'Send report'}
        </PrimaryButton>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-sm text-foreground/60 underline hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function BlockConfirm({
  member,
  onDone,
  onCancel,
}: {
  member: TripMember;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleBlock() {
    setError(null);
    setBusy(true);
    try {
      await blockUser(member.userId);
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not block them — try again.');
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-sm text-foreground/80">
        Block {member.user.name}? You&apos;ll stop seeing each other in discovery, on trip pages, in travellers lists and
        in chat, and they won&apos;t be told. It doesn&apos;t remove them from a trip you share, and you can unblock
        from your profile any time.
      </p>
      <ErrorText>{error}</ErrorText>
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={handleBlock}
          disabled={busy}
          className="rounded-full border border-danger px-4 py-1.5 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
        >
          {busy ? 'Blocking…' : 'Yes, block'}
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
    </div>
  );
}
