export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Tag {
  id: string;
  name: string;
  category: 'STYLE' | 'IDENTITY' | 'DIETARY' | 'SAFETY';
  isActive: boolean;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  bio: string | null;
  homeCity: string | null;
  homeRegion: string | null;
  trustScore: number;
  verificationTier: 'EMAIL' | 'PHONE' | 'ID';
  accountStatus: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  createdAt: string;
  updatedAt: string;
  preferenceTags?: Tag[];
}

export interface AuthResponse {
  user: PublicUser;
  accessToken: string;
}

// Held in module scope rather than React state so any call site can use
// apiFetch() without threading the token through every function signature.
// AuthProvider is the only thing that calls setAccessToken.
let accessToken: string | null = null;
let onExpired: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** For the one caller that can't just go through apiFetch — the Socket.io handshake needs the raw token. */
export function getAccessToken(): string | null {
  return accessToken;
}

/** AuthProvider registers a callback here to react to a session that can no longer be refreshed. */
export function onSessionExpired(callback: () => void): void {
  onExpired = callback;
}

async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    return Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? res.statusText);
  } catch {
    return res.statusText;
  }
}

let inFlightRefresh: Promise<PublicUser | null> | null = null;

/**
 * Uses the httpOnly refresh cookie (path-scoped to /auth) — never touches JS-readable storage.
 *
 * Concurrent callers share one request. The refresh token rotates on use, so
 * a second request carrying the same cookie either orphans a token or loses
 * the race and gets a 401 — and a 401 here signs the user out of a session
 * that was perfectly good. Parallel callers are normal: React Strict Mode
 * double-runs the mount effect, and a page that fires two requests with an
 * expired access token gets two 401s at once.
 */
export function refreshSession(): Promise<PublicUser | null> {
  inFlightRefresh ??= requestRefresh().finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
}

async function requestRefresh(): Promise<PublicUser | null> {
  const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (!res.ok) return null;
  const data = (await res.json()) as AuthResponse;
  accessToken = data.accessToken;
  return data.user;
}

/**
 * Core request helper. On a 401 from an already-authenticated call, tries
 * exactly one silent refresh-and-retry before giving up and notifying
 * AuthProvider — never loops, never retries a request that was never
 * authenticated in the first place.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await rawFetch(path, init);

  if (res.status === 401 && accessToken !== null) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await rawFetch(path, init);
    } else {
      accessToken = null;
      onExpired?.();
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, await readErrorMessage(res));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function registerAccount(email: string, password: string, name: string) {
  return apiFetch<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
}

export function login(email: string, password: string) {
  return apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<void> {
  await apiFetch<void>('/auth/logout', { method: 'POST' });
  accessToken = null;
}

export function getMe() {
  return apiFetch<PublicUser>('/users/me');
}

export function updateMe(data: {
  name?: string;
  bio?: string;
  homeCity?: string;
  homeRegion?: string;
  preferenceTagIds?: string[];
}) {
  return apiFetch<PublicUser>('/users/me', { method: 'PATCH', body: JSON.stringify(data) });
}

export function getTags() {
  return apiFetch<Tag[]>('/tags');
}

// ---------- Trips ----------

export type TripStatus = 'DRAFT' | 'OPEN' | 'FULL' | 'ONGOING' | 'COMPLETED' | 'CANCELLED';
export type TripVisibility = 'PUBLIC' | 'UNLISTED';
export type MembershipRole = 'HOST' | 'MEMBER';
export type MembershipStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'LEFT' | 'REMOVED';

export interface TripHost {
  id: string;
  name: string;
  trustScore: number;
  homeCity: string | null;
}

export interface Trip {
  id: string;
  hostId: string;
  title: string;
  description: string | null;
  destination: string;
  startDate: string;
  endDate: string;
  flexibleDates: boolean;
  budgetMin: number;
  budgetMax: number;
  capacity: number;
  tripType: string | null;
  status: TripStatus;
  visibility: TripVisibility;
  coverPhotoUrl: string | null;
  createdAt: string;
  updatedAt: string;
  includeTags: Tag[];
  // Present only when the caller is the host — BLUEPRINT §01/§09.
  excludeTags?: Tag[];
  host: TripHost;
}

export interface DiscoveredTrip extends Trip {
  matchScore: number;
}

export interface TripDetail extends Trip {
  approvedCount: number;
  myMembership: { status: MembershipStatus; role: MembershipRole } | null;
}

export interface TripMembership {
  id: string;
  tripId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  requestedAt: string;
  respondedAt: string | null;
  leftAt: string | null;
}

export interface MyTripMembership extends TripMembership {
  trip: Trip;
}

export interface TripRequest extends TripMembership {
  user: {
    id: string;
    name: string;
    bio: string | null;
    homeCity: string | null;
    trustScore: number;
    preferenceTags: Tag[];
  };
}

export interface CreateTripInput {
  title: string;
  description?: string;
  destination: string;
  startDate: string;
  endDate: string;
  flexibleDates?: boolean;
  budgetMin: number;
  budgetMax: number;
  capacity: number;
  includeTagIds?: string[];
  excludeTagIds?: string[];
  tripType?: string;
  visibility?: TripVisibility;
}

export function createTrip(data: CreateTripInput) {
  return apiFetch<Trip>('/trips', { method: 'POST', body: JSON.stringify(data) });
}

export interface DiscoverParams {
  budgetMin?: number;
  budgetMax?: number;
  startDate?: string;
  endDate?: string;
  destination?: string;
  limit?: number;
}

export function discoverTrips(params: DiscoverParams = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const qs = query.toString();
  return apiFetch<DiscoveredTrip[]>(`/trips/discover${qs ? `?${qs}` : ''}`);
}

export function getTrip(id: string) {
  return apiFetch<TripDetail>(`/trips/${id}`);
}

export function listMyTrips() {
  return apiFetch<MyTripMembership[]>('/trips/mine');
}

export function requestToJoinTrip(tripId: string) {
  return apiFetch<TripMembership>(`/trips/${tripId}/requests`, { method: 'POST' });
}

export function listTripRequests(tripId: string) {
  return apiFetch<TripRequest[]>(`/trips/${tripId}/requests`);
}

export function respondToTripRequest(tripId: string, membershipId: string, decision: 'APPROVED' | 'REJECTED') {
  return apiFetch<TripMembership>(`/trips/${tripId}/requests/${membershipId}`, {
    method: 'PATCH',
    body: JSON.stringify({ decision }),
  });
}

export function leaveTrip(tripId: string) {
  return apiFetch<unknown>(`/trips/${tripId}/leave`, { method: 'POST' });
}

// ---------- Chat ----------

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  content: string;
  createdAt: string;
  sender: { id: string; name: string };
}

/** Oldest-first within the page. `before` (a message id) pages further back in history. */
export function listMessages(tripId: string, before?: string, limit = 50) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (before) query.set('before', before);
  return apiFetch<ChatMessage[]>(`/trips/${tripId}/messages?${query.toString()}`);
}
