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
import { Button, Card, Chip } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { IconShield } from '@/components/icons';

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
    <section className="mt-9" aria-labelledby="travellers-heading">
      <h2 id="travellers-heading" className="text-xl font-bold">
        Travellers
        <span className="ml-2 text-base font-medium text-muted">{members.length}</span>
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {members.map((m) => {
          const isMe = m.userId === meId;
          const open = panel?.userId === m.userId ? panel.kind : null;
          return (
            <li key={m.userId}>
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <UserAvatar user={m.user} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold leading-tight">
                      {m.user.name}
                      {isMe && <span className="font-normal text-muted"> (you)</span>}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[0.9rem] text-muted">
                      <span className="inline-flex items-center gap-1">
                        <IconShield size={15} className="text-accent-ink" />
                        Trust {Math.round(m.user.trustScore)}
                      </span>
                      {m.role === 'HOST' && (
                        <Chip tone="accent" className="!px-2 !py-0 !text-[0.8rem]">
                          Host
                        </Chip>
                      )}
                    </p>
                  </div>
                  {!isMe && open === null && (
                    <div className="flex shrink-0 gap-1">
                      {reported.has(m.userId) ? (
                        <span className="px-3 text-[0.9rem] text-muted">Reported</span>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setPanel({ userId: m.userId, kind: 'report' })}>
                          Report
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="!text-danger" onClick={() => setPanel({ userId: m.userId, kind: 'block' })}>
                        Block
                      </Button>
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
              </Card>
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
      <p className="text-[0.9rem] text-muted">
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
      <div className="flex items-center gap-3">
        <PrimaryButton type="submit" disabled={submitting} className="w-fit">
          {submitting ? 'Sending…' : 'Send report'}
        </PrimaryButton>
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
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
      <p>
        Block {member.user.name}? You&apos;ll stop seeing each other in discovery, on trip pages, in travellers lists and
        in chat, and they won&apos;t be told. It doesn&apos;t remove them from a trip you share, and you can unblock
        from your profile any time.
      </p>
      <ErrorText>{error}</ErrorText>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="danger" onClick={handleBlock} disabled={busy}>
          {busy ? 'Blocking…' : 'Yes, block'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
