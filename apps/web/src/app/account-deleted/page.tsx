import Link from 'next/link';

/** Where someone lands after deleting their account. Public on purpose: they're signed out by now. */
export default function AccountDeletedPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Your account has been deleted</h1>
      <p className="max-w-md text-sm text-foreground/70">
        You&apos;re signed out everywhere and your profile is gone. Messages, expenses and reviews you shared with other
        people remain on their trips as &ldquo;Deleted user&rdquo;. You&apos;re welcome back any time — you&apos;d start
        fresh.
      </p>
      <Link href="/" className="text-sm text-accent hover:underline">
        Back to the start
      </Link>
    </main>
  );
}
