'use client';

import { apiBlob } from '@/lib/api';
import { useQuery } from '@/lib/query';

// Pictures and voice notes are protected: only the right people may fetch them. An <img src> or <audio src>
// cannot send the login session (it is a header), so they are fetched like any other request and shown from a
// local address. Each file is fetched once however many places show it (a person's picture appears in the
// feed, the chat, expenses...), and remembered for the visit.

const files = new Map<string, Promise<string>>();

/** The local address of a protected file, fetching it the first time. */
export function loadMedia(path: string): Promise<string> {
  let pending = files.get(path);
  if (!pending) {
    pending = apiBlob(path).then((blob) => URL.createObjectURL(blob));
    files.set(path, pending);
    // A failure is not remembered, so the next look tries again.
    pending.catch(() => {
      if (files.get(path) === pending) files.delete(path);
    });
  }
  return pending;
}

/** Forgets every fetched file. For sign-in and sign-out: the next person must not see the last one's pictures. */
export function clearMediaCache(): void {
  for (const pending of files.values()) pending.then((url) => URL.revokeObjectURL(url), () => undefined);
  files.clear();
}

export interface MediaUrl {
  url: string | null;
  loading: boolean;
  failed: boolean;
}

/** Shows a protected file: null until it has arrived. Pass null to show nothing. */
export function useMediaUrl(path: string | null, enabled = true): MediaUrl {
  // A file never changes under its address, so once fetched it is never fetched again this visit.
  const { data, error, isLoading } = useQuery(path ? `media:${path}` : null, () => loadMedia(path as string), {
    staleMs: Number.POSITIVE_INFINITY,
    enabled,
  });
  return { url: data ?? null, loading: isLoading, failed: !!error && !data };
}
