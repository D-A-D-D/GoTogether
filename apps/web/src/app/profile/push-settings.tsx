'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { disablePush, enablePush, getPushStatus, PushPermissionError, type PushStatus } from '@/lib/push';
import { ErrorText, PrimaryButton } from '@/components/form-controls';

/**
 * Push notifications for this device: whether they're on, and the switch.
 * `standalone` is for a page that already carries the title: no heading, no margin made for sitting below other content.
 */
export function PushSettings({ standalone = false }: { standalone?: boolean }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getPushStatus());
    } catch {
      setStatus({ kind: 'unsupported', reason: "Couldn't check this device's notification settings." });
    }
  }, []);

  useEffect(() => {
    // Deferred a microtask so setState never happens synchronously within
    // the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  async function handleEnable() {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      await enablePush(user.id);
    } catch (err) {
      if (err instanceof PushPermissionError) {
        // A hard "denied" is explained by the status text itself once
        // refresh() runs; only a dismissed prompt needs a message here.
        if (Notification.permission !== 'denied') setError("You didn't allow notifications, so they're still off.");
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(`Couldn't turn on notifications${err instanceof Error ? `: ${err.message}` : ' — try again.'}`);
      }
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function handleDisable() {
    setError(null);
    setBusy(true);
    try {
      await disablePush();
    } catch (err) {
      setError(`Couldn't turn off notifications${err instanceof Error ? `: ${err.message}` : ' — try again.'}`);
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  return (
    <section className={standalone ? undefined : 'mt-12'}>
      {!standalone && <h2 className="text-xl font-bold">Notifications</h2>}

      {status === null && <p className="mt-1 text-[0.95rem] text-muted">Checking this device…</p>}

      {status?.kind === 'unsupported' && <p className="mt-1 text-[0.95rem] text-muted">{status.reason}</p>}

      {status?.kind === 'denied' && (
        <p className="mt-1 text-[0.95rem] text-muted">
          Notifications are blocked for GoTogether in your browser&apos;s settings. Allow them there, then come back to
          turn them on.
        </p>
      )}

      {(status?.kind === 'off' || status?.kind === 'on') && (
        <>
          <p className="mt-1 text-[0.95rem] text-muted">
            Hear about join requests, approvals, new chat messages and reviews about you &mdash; even when GoTogether
            isn&apos;t open. This applies to this device only.
          </p>
          <div className="mt-3 flex items-center gap-4">
            {status.kind === 'off' ? (
              <PrimaryButton type="button" onClick={handleEnable} disabled={busy} className="w-fit px-6">
                {busy ? 'Turning on…' : 'Turn on notifications'}
              </PrimaryButton>
            ) : (
              <>
                <span className="text-[0.95rem] text-accent-ink">Notifications are on for this device.</span>
                <button
                  type="button"
                  onClick={handleDisable}
                  disabled={busy}
                  className="inline-flex min-h-11 items-center px-2 text-[0.95rem] font-semibold text-accent-ink underline-offset-4 hover:underline disabled:opacity-50"
                >
                  {busy ? 'Turning off…' : 'Turn off'}
                </button>
              </>
            )}
          </div>
        </>
      )}

      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </section>
  );
}
