import type { ReactNode } from 'react';

// Every screen under a trip is a client component that reads the trip's id from the address and
// fetches its own data; nothing here needs the server per visit. Saying so lets Next treat these
// as static pages made on demand and kept, rather than "dynamic" ones. The difference is
// navigation speed: a dynamic route is not prefetched and costs a server round trip on every
// click; a static one is prefetched as its link comes into view, and opens straight away.
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

export default function TripLayout({ children }: { children: ReactNode }) {
  return children;
}
