'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRequireAuth } from '@/lib/use-require-auth';
import { ApiError, discoverTrips, type DiscoverParams, type DiscoveredTrip } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { Label, TextInput, ErrorText } from '@/components/form-controls';
import { Button, EmptyState, ButtonLink } from '@/components/ui';
import { TripCard, TripCardSkeleton } from '@/components/trip-card';
import { IconSearch, IconSliders } from '@/components/icons';

// Passed explicitly (rather than relying on the server's default) because
// "a full page came back" is how we know there may be more to show.
const PAGE_SIZE = 20;

export default function DiscoverTripsPage() {
  const status = useRequireAuth();

  // What is typed in the boxes, versus `applied`: what the list on screen is for. The filters
  // panel applies on "Show trips"; the destination box applies as you pause typing.
  const [destination, setDestination] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [applied, setApplied] = useState({ destination: '', budgetMin: '', budgetMax: '', startDate: '', endDate: '' });
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Applies the destination once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setApplied((a) => (a.destination === destination.trim() ? a : { ...a, destination: destination.trim() })), 400);
    return () => clearTimeout(timer);
  }, [destination]);

  const query: DiscoverParams = useMemo(
    () => ({
      destination: applied.destination || undefined,
      budgetMin: applied.budgetMin ? Number(applied.budgetMin) : undefined,
      budgetMax: applied.budgetMax ? Number(applied.budgetMax) : undefined,
      startDate: applied.startDate || undefined,
      endDate: applied.endDate || undefined,
      limit: PAGE_SIZE,
    }),
    [applied],
  );
  const key = `discover:${JSON.stringify(query)}`;
  const first = useQuery(key, () => discoverTrips(query), { enabled: status === 'authenticated' });

  // Pages after the first, for the search they belong to. Keyed, so changing the search drops them.
  const [more, setMore] = useState<{ key: string; items: DiscoveredTrip[]; done: boolean }>({ key: '', items: [], done: false });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const extra = more.key === key ? more : { key, items: [], done: false };

  const trips = useMemo(() => {
    if (!first.data) return undefined;
    // Deduped, in case a trip was added while browsing and shifted the pages.
    const seen = new Set<string>();
    return [...first.data, ...extra.items].filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  }, [first.data, extra.items]);
  const hasMore = !!first.data && first.data.length === PAGE_SIZE && !extra.done;

  const loadingMoreRef = useRef(false);
  async function loadMore() {
    if (!trips || loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await discoverTrips({ ...query, offset: trips.length });
      setMore((prev) => {
        const base = prev.key === key ? prev.items : [];
        return { key, items: [...base, ...next], done: next.length < PAGE_SIZE };
      });
    } catch (err) {
      setMoreError(err instanceof ApiError ? err.message : 'Could not load more trips - try again.');
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

  // Scrolling near the end of the list brings the next page in, like a feed.
  const sentinel = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  });
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void loadMoreRef.current(), { rootMargin: '600px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, trips?.length]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setApplied({ destination: destination.trim(), budgetMin, budgetMax, startDate, endDate });
    setFiltersOpen(false);
  }

  function resetFilters() {
    setBudgetMin('');
    setBudgetMax('');
    setStartDate('');
    setEndDate('');
    setApplied((a) => ({ ...a, budgetMin: '', budgetMax: '', startDate: '', endDate: '' }));
    setFiltersOpen(false);
  }

  const activeFilters = [applied.budgetMin, applied.budgetMax, applied.startDate, applied.endDate].filter(Boolean).length;

  if (status !== 'authenticated') return null;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-8 pt-4">
      <h1 className="sr-only">Discover trips</h1>
      <form onSubmit={applyFilters} className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <IconSearch size={22} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <TextInput
              aria-label="Where to?"
              placeholder="Where to?"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="!rounded-full pl-12"
            />
          </div>
          <Button
            variant={filtersOpen || activeFilters > 0 ? 'primary' : 'secondary'}
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="filters"
            className="relative !px-4"
          >
            <IconSliders size={20} />
            <span className="hidden sm:inline">Filters</span>
            {activeFilters > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-[0.85rem] font-bold text-on-gold">
                {activeFilters}
              </span>
            )}
          </Button>
        </div>

        {filtersOpen && (
          <div id="filters" className="pop-in grid grid-cols-2 gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="budgetMin">Budget from (₹)</Label>
              <TextInput id="budgetMin" type="number" inputMode="numeric" min={0} value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="budgetMax">Budget to (₹)</Label>
              <TextInput id="budgetMax" type="number" inputMode="numeric" min={0} value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="startDate">Leaving after</Label>
              <TextInput id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="endDate">Back before</Label>
              <TextInput id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="col-span-2 flex justify-end gap-2">
              <Button variant="ghost" onClick={resetFilters}>
                Clear
              </Button>
              <Button type="submit">Show trips</Button>
            </div>
          </div>
        )}
      </form>

      {/* A thin bar while a refresh runs underneath trips that are already on screen. */}
      <div className="mt-3 h-1 overflow-hidden rounded-full" aria-hidden="true">
        {first.isRefreshing && <div className="skeleton h-full w-full" />}
      </div>

      <div className="mt-3 flex flex-col gap-5">
        <ErrorText>{first.error && !first.data ? first.error.message || 'Could not load trips - try again.' : null}</ErrorText>

        {first.isLoading && [0, 1, 2].map((i) => <TripCardSkeleton key={i} />)}

        {trips?.length === 0 && (
          <EmptyState
            title="No trips match yet"
            action={
              <ButtonLink href="/trips/new" variant="secondary">
                Host the first one
              </ButtonLink>
            }
          >
            Try a wider budget or different dates - or start a trip yourself and let people find you.
          </EmptyState>
        )}

        {trips?.map((trip) => <TripCard key={trip.id} trip={trip} />)}

        {loadingMore && <TripCardSkeleton />}
        <ErrorText>{moreError}</ErrorText>
        {hasMore && !loadingMore && <div ref={sentinel} className="h-px" />}
      </div>
    </main>
  );
}
