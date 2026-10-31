import { Injectable, Logger } from '@nestjs/common';

// Finds a free picture of a trip's place, so a trip has a real cover instead of the generated one.
// The source is Wikipedia / Wikimedia Commons: free, no account or key, and its pictures are openly licensed
// (credit them: the app says so in Settings). Only pictures hosted by Wikimedia are ever accepted, whatever
// a response claims. A lookup is a few small requests with a short timeout and never blocks saving a trip.

const API_TIMEOUT_MS = 4000;
const USER_AGENT = 'GoTogether/1.0 (trip cover photos; https://github.com/Dhananjaytanan/GoTogether)';
const WIDTH = 960;
/** Where Wikimedia serves pictures from (thumbnails come from the second). Exact names only. */
const PHOTO_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);

/** The words worth looking up for a trip: the place as typed, then each part of it ("Munnar and Alleppey, Kerala"). */
export function coverSearchTerms(destination: string): string[] {
  const whole = destination.trim().replace(/\s+/g, ' ');
  const parts = whole
    .split(/,|\/|\band\b|&|\+/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3);
  return [...new Set([whole, ...parts])].filter((t) => t.length >= 3).slice(0, 4);
}

/** Only a picture on one of Wikimedia's own hosts, over https. Returns it at a card-friendly width, or null. */
export function acceptedPhotoUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let url: URL;
  try {
    url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !PHOTO_HOSTS.has(url.hostname)) return null;
  // A thumbnail address carries its width ("/320px-Name.jpg"); ask for a wider one. Anything else is used as it is.
  return url.href.includes('/thumb/') ? url.href.replace(/\/\d+px-/, `/${WIDTH}px-`) : url.href;
}

type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

@Injectable()
export class CoverPhotoService {
  private readonly logger = new Logger(CoverPhotoService.name);

  /** Overridable in tests. */
  fetcher: Fetcher = (url, init) => fetch(url, init);

  private async getJson(url: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await this.fetcher(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
      if (!res.ok) return null;
      const body = await res.json();
      return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  /** The picture on one article, if it is about a real place (not a "may refer to" page) and has one. */
  private async photoFor(title: string): Promise<string | null> {
    const summary = await this.getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`);
    if (!summary || summary.type === 'disambiguation') return null;
    const thumbnail = summary.thumbnail as { source?: unknown } | undefined;
    return acceptedPhotoUrl(thumbnail?.source);
  }

  /** Titles of the best-matching articles for some words (the trip's name and description help when the place is vague). */
  private async search(query: string): Promise<string[]> {
    const found = await this.getJson(`https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(query)}&limit=3`);
    const pages = Array.isArray(found?.pages) ? (found.pages as Array<{ key?: unknown }>) : [];
    return pages.map((p) => p.key).filter((k): k is string => typeof k === 'string');
  }

  /** A picture for the trip, or null if none was found. Never throws. */
  async find(destination: string, hint = ''): Promise<string | null> {
    try {
      for (const term of coverSearchTerms(destination)) {
        const photo = await this.photoFor(term);
        if (photo) return photo;
      }
      for (const key of await this.search(`${destination} ${hint}`.trim().slice(0, 120))) {
        const photo = await this.photoFor(key);
        if (photo) return photo;
      }
    } catch (error) {
      this.logger.warn(`Cover photo lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  }
}
