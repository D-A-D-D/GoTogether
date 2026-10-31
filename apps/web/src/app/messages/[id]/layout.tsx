import type { ReactNode } from 'react';

// A private chat reads its id from the address and fetches its own data, like the screens under a trip: let Next
// treat it as a static page made on demand (prefetched, instant to open) rather than a dynamic one.
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

export default function PrivateChatLayout({ children }: { children: ReactNode }) {
  return children;
}
