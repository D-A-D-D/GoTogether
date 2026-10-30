import { Skeleton } from '@/components/ui';

// Shown the instant a trip screen is opened, while its code and data arrive, so a tap is
// answered at once instead of leaving the old screen sitting there.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-8 pt-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="aspect-[16/10] w-full !rounded-3xl" />
      <Skeleton className="mt-5 h-7 w-2/3" />
      <Skeleton className="mt-3 h-24 w-full !rounded-2xl" />
      <Skeleton className="mt-3 h-16 w-full !rounded-2xl" />
    </main>
  );
}
