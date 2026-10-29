import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="flex justify-center gap-4 px-6 py-6 text-xs text-foreground/60">
      <Link href="/terms" className="hover:text-foreground">
        Terms
      </Link>
      <Link href="/privacy" className="hover:text-foreground">
        Privacy
      </Link>
    </footer>
  );
}
