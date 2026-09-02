import { HealthStatus } from "@/components/health-status";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-accent">
        GoTogether — Phase 0
      </p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Travel together, not alone.
      </h1>
      <p className="max-w-md text-base text-foreground/70">
        Profiles, matching, trips, and trust scores are on the way. This is
        the app shell — installable, and talking to the API below.
      </p>
      <HealthStatus />
    </main>
  );
}
