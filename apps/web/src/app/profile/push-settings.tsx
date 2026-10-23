'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { disablePush, enablePush, getPushStatus, PushPermissionError, type PushStatus } from '@/lib/push';
import { ErrorText, PrimaryButton } from '@/components/form-controls';

/** Push notifications for this device: whether they're on, and the switch. */
export function PushSettings() {
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
    <section className="mt-12">
      <h2 className="text-lg font-semibold tracking-tight">Notifications</h2>

      {status === null && <p className="mt-1 text-sm text-foreground/60">Checking this device…</p>}

      {status?.kind === 'unsupported' && <p className="mt-1 text-sm text-foreground/60">{status.reason}</p>}

      {status?.kind === 'denied' && (
        <p className="mt-1 text-sm text-foreground/60">
          Notifications are blocked for GoTogether in your browser&apos;s settings. Allow them there, then come back to
          turn them on.
        </p>
      )}

      {(status?.kind === 'off' || status?.kind === 'on') && (
        <>
          <p className="mt-1 text-sm text-foreground/60">
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
                <span className="text-sm text-accent">Notifications are on for this device.</span>
                <button
                  type="button"
                  onClick={handleDisable}
                  disabled={busy}
                  className="text-sm text-foreground/60 underline hover:text-foreground disabled:opacity-50"
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
