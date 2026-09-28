import { Injectable } from '@nestjs/common';
import type { Tag } from '../generated/prisma/index.js';

export interface SearchIntent {
  budgetMin?: number;
  budgetMax?: number;
  startDate?: string;
  endDate?: string;
}

interface ScorableTrip {
  destination: string;
  startDate: Date;
  endDate: Date;
  flexibleDates: boolean;
  budgetMin: number;
  budgetMax: number;
  includeTags: Tag[];
}

interface ScorableUser {
  homeCity: string | null;
  preferenceTags: Tag[];
}

const WEIGHTS = {
  tagAffinity: 0.4,
  dateFit: 0.25,
  budgetFit: 0.25,
  location: 0.1,
};

const FLEXIBLE_DATE_BUFFER_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Stage 2 of BLUEPRINT §04: a weighted score over whichever survives
 * Stage 1's hard filters. Only the aggregate percentage this produces is
 * ever returned to a client — the per-factor breakdown stays server-side,
 * which is what makes "helping users discover trips without revealing why"
 * actually true.
 *
 * Budget and dates are the user's *search intent* for this query, not a
 * standing profile field (see DiscoverTripsDto) — when the caller doesn't
 * supply them, that factor is dropped and the remaining weights are
 * renormalized, rather than guessing at a filler score.
 */
@Injectable()
export class MatchingService {
  score(user: ScorableUser, trip: ScorableTrip, intent: SearchIntent): number {
    const factors: Array<{ weight: number; value: number }> = [
      { weight: WEIGHTS.tagAffinity, value: this.tagAffinity(user.preferenceTags, trip.includeTags) },
      { weight: WEIGHTS.location, value: this.locationFit(user.homeCity, trip.destination) },
    ];

    if (intent.startDate && intent.endDate) {
      factors.push({ weight: WEIGHTS.dateFit, value: this.dateFit(intent.startDate, intent.endDate, trip) });
    }
    if (intent.budgetMin !== undefined && intent.budgetMax !== undefined) {
      factors.push({ weight: WEIGHTS.budgetFit, value: this.budgetFit(intent.budgetMin, intent.budgetMax, trip) });
    }

    const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
    const weightedSum = factors.reduce((sum, f) => sum + f.weight * f.value, 0);
    return Math.round((weightedSum / totalWeight) * 100);
  }

  /** Jaccard overlap between the user's tags and the trip's include tags. */
  private tagAffinity(userTags: Tag[], tripTags: Tag[]): number {
    if (tripTags.length === 0) return 0.5; // host stated no preference — neutral, not a penalty
    const userIds = new Set(userTags.map((t) => t.id));
    const tripIds = new Set(tripTags.map((t) => t.id));
    const overlap = [...tripIds].filter((id) => userIds.has(id)).length;
    const union = new Set([...userIds, ...tripIds]).size;
    return overlap / union;
  }

  private dateFit(wantStartIso: string, wantEndIso: string, trip: ScorableTrip): number {
    const wantStart = new Date(wantStartIso).getTime();
    const wantEnd = new Date(wantEndIso).getTime();
    let tripStart = trip.startDate.getTime();
    let tripEnd = trip.endDate.getTime();
    if (trip.flexibleDates) {
      tripStart -= FLEXIBLE_DATE_BUFFER_MS;
      tripEnd += FLEXIBLE_DATE_BUFFER_MS;
    }
    const overlapMs = Math.max(0, Math.min(wantEnd, tripEnd) - Math.max(wantStart, tripStart));
    const wantSpanMs = Math.max(wantEnd - wantStart, 1);
    return Math.min(1, overlapMs / wantSpanMs);
  }

  private budgetFit(wantMin: number, wantMax: number, trip: ScorableTrip): number {
    const overlap = Math.max(0, Math.min(wantMax, trip.budgetMax) - Math.max(wantMin, trip.budgetMin));
    const wantSpan = Math.max(wantMax - wantMin, 1);
    return Math.min(1, overlap / wantSpan);
  }

  /**
   * Simplified pending real geocoding (docs/IDEAS.md) — Trip only carries a
   * free-text `destination`, there's no lat/lng or PostGIS wired up yet.
   * A text match is a reasonable stand-in given this factor is capped to
   * 10% by design either way.
   */
  private locationFit(userCity: string | null, destination: string): number {
    if (!userCity) return 0.5;
    const a = userCity.trim().toLowerCase();
    const b = destination.trim().toLowerCase();
    if (!a || !b) return 0.5;
    return a === b || b.includes(a) || a.includes(b) ? 1 : 0.3;
  }
}
