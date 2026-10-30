import { ButtonLink } from '@/components/ui';

/** Where someone lands after deleting their account. Public on purpose: they're signed out by now. */
export default function AccountDeletedPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="font-display text-3xl font-bold">Your account has been deleted</h1>
      <p className="max-w-md text-lg text-muted">
        You&apos;re signed out everywhere and your profile is gone. Messages, expenses and reviews you shared with other
        people remain on their trips as &ldquo;Deleted user&rdquo;. You&apos;re welcome back any time — you&apos;d start
        fresh.
      </p>
      <ButtonLink href="/" variant="secondary" className="mt-2">
        Back to the start
      </ButtonLink>
    </main>
  );
}
