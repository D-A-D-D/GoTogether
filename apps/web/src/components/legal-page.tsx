import type { ReactNode } from 'react';

/**
 * Shared frame for the Terms and Privacy pages. They are drafts written from what the app
 * actually does; LEGAL_DRAFT shows a notice until someone qualified has reviewed them and the
 * placeholders in square brackets are filled in (docs/ROADMAP.md, "Launch readiness").
 */
export const LEGAL_DRAFT = true;

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-foreground/60">Last updated {updated}</p>
      {LEGAL_DRAFT && (
        <p className="mt-4 rounded-lg border border-line bg-foreground/5 p-3 text-sm text-foreground/80">
          Draft: this text has not yet been reviewed by a lawyer, and items in [square brackets] are still to be filled in.
        </p>
      )}
      <div className="mt-6 flex flex-col gap-4 text-sm leading-6 text-foreground/80 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </div>
    </main>
  );
}
