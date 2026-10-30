import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="mt-auto flex justify-center gap-6 px-6 py-8 text-[0.9rem] text-muted">
      <Link href="/terms" className="underline-offset-4 hover:text-foreground hover:underline">
        Terms
      </Link>
      <Link href="/privacy" className="underline-offset-4 hover:text-foreground hover:underline">
        Privacy
      </Link>
    </footer>
  );
}
