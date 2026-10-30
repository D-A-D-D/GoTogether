'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, deleteMyAccount, exportMyData } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { disablePush } from '@/lib/push';
import { ErrorText, Label, TextInput } from '@/components/form-controls';

/** Download everything the app holds about you, or delete the account. */
export function AccountSettings() {
  const { user } = useAuth();

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [proof, setProof] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!user) return null;

  async function handleDownload() {
    setDownloadError(null);
    setDownloading(true);
    try {
      const data = await exportMyData();
      // The session is an in-memory token, not a cookie, so a plain link can't
      // fetch this: get it with the token, then hand the browser a file.
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'gotogether-my-data.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err.message : 'Could not prepare your data — try again.');
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete(event: FormEvent) {
    event.preventDefault();
    if (!proof.trim() || deleting) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteMyAccount(user!.hasPassword ? { password: proof } : { confirmEmail: proof.trim() });
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete the account — try again.');
      setDeleting(false);
      return;
    }
    // It's gone server-side. Switch this device's notifications off, then leave with a
    // full page load: it drops the session held in memory and avoids the protected page
    // sending us to the login screen as the session ends.
    await disablePush().catch(() => undefined);
    window.location.replace('/account-deleted');
  }

  return (
    <section className="mt-12">
      <h2 className="text-xl font-bold">Your data</h2>
      <p className="mt-1 text-[0.95rem] text-muted">
        Download a copy of what GoTogether holds about you, or delete your account.
      </p>

      <div className="mt-3 flex flex-col gap-1">
        <div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="rounded-full border border-line px-4 py-2 text-[0.95rem] text-foreground/80 hover:border-accent/50 hover:text-foreground disabled:opacity-50"
          >
            {downloading ? 'Preparing…' : 'Download my data'}
          </button>
        </div>
        <ErrorText>{downloadError}</ErrorText>
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-surface shadow-card p-4">
        <h3 className="text-[0.95rem] font-medium">Delete my account</h3>
        {!confirming ? (
          <>
            <p className="mt-1 text-[0.95rem] text-muted">
              This can&apos;t be undone. You&apos;ll be signed out everywhere and can&apos;t sign in again.
            </p>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mt-3 rounded-full border border-danger/50 px-4 py-2 text-[0.95rem] text-danger hover:bg-danger/10"
            >
              Delete my account…
            </button>
          </>
        ) : (
          <form onSubmit={handleDelete} className="mt-1 flex flex-col gap-3">
            <ul className="list-disc space-y-1 pl-5 text-[0.95rem] text-muted">
              <li>Your profile (including your profile picture), sign-in, notifications, blocks and trust history are deleted.</li>
              <li>You leave any trip that hasn&apos;t finished, and your pending requests are withdrawn.</li>
              <li>
                Messages you sent (with any pictures or voice messages in them), expenses you shared and reviews you wrote
                stay on other people&apos;s trips, shown as &ldquo;Deleted user&rdquo; — they&apos;re part of other
                people&apos;s records and they need them to settle up.
              </li>
              <li>You can&apos;t delete while you host a trip that hasn&apos;t finished — cancel or complete it first.</li>
              <li>You can sign up again later, but as a new person: nothing carries over.</li>
            </ul>

            <div>
              <Label htmlFor="delete-proof">
                {user.hasPassword ? 'Enter your password to confirm' : `Type your email address (${user.email}) to confirm`}
              </Label>
              <TextInput
                id="delete-proof"
                type={user.hasPassword ? 'password' : 'email'}
                autoComplete={user.hasPassword ? 'current-password' : 'off'}
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                className="mt-1"
              />
            </div>
            <ErrorText>{deleteError}</ErrorText>

            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={deleting || !proof.trim()}
                className="rounded-full border border-danger px-4 py-2 text-[0.95rem] font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Permanently delete my account'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setProof('');
                  setDeleteError(null);
                }}
                disabled={deleting}
                className="inline-flex min-h-11 items-center px-2 text-[0.95rem] font-semibold text-accent-ink underline-offset-4 hover:underline disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
