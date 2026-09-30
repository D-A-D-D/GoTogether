import Link from 'next/link';
import type { Trip, DiscoveredTrip } from '@/lib/api';

function formatDateRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const fmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

export function TripCard({ trip }: { trip: Trip | DiscoveredTrip }) {
  const matchScore = 'matchScore' in trip ? trip.matchScore : undefined;

  return (
    <Link
      href={`/trips/${trip.id}`}
      className="block rounded-xl border border-line bg-surface p-5 transition hover:border-accent/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-foreground">{trip.title}</h3>
          <p className="text-sm text-foreground/60">{trip.destination}</p>
        </div>
        {matchScore !== undefined && (
          <div className="shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-center">
            <div className="font-mono text-sm font-semibold text-accent">{matchScore}%</div>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/60">
        <span>{formatDateRange(trip.startDate, trip.endDate)}</span>
        <span>
          {trip.budgetMin}&ndash;{trip.budgetMax} budget
        </span>
        <span>Hosted by {trip.host.name}</span>
      </div>

      {trip.includeTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {trip.includeTags.map((tag) => (
            <span
              key={tag.id}
              className="rounded-full border border-line px-2 py-0.5 text-xs text-foreground/70"
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
