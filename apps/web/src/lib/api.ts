import { endpointUrl } from './endpoint';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Sign-in through this site's own address instead of the API's, for deployments where the two
// are on unrelated domains. Both halves are fixed at build time: see next.config.ts.
const AUTH_VIA_WEB = process.env.NEXT_PUBLIC_AUTH_VIA_WEB === 'true';
const urlFor = (path: string) => endpointUrl(path, { apiUrl: API_URL, authViaWeb: AUTH_VIA_WEB });

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
  accountStatus: AccountStatus;
  /** False for an account that signed up with Google and never set one. */
  hasPassword: boolean;
  /** When they confirmed their email address by following the link we sent; null until then. */
  emailVerifiedAt: string | null;
  /** Only ever changed by an operator with database access — see apps/api/scripts/set-role.ts. */
  role: 'USER' | 'ADMIN';
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
  return fetch(urlFor(path), {
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

/**
 * Asks the API for a health answer straight (not through the sign-in relay) and waits as long
 * as it takes: a free-tier API that has gone to sleep needs up to a minute to wake, and the
 * relay may give up sooner than that.
 */
async function wakeApi(): Promise<void> {
  await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(90_000) }).catch(() => undefined);
}

/** A reply that means "the API wasn't there", as opposed to "the session is no good". */
const isUnavailable = (status: number) => status === 502 || status === 503 || status === 504;

async function requestRefresh(): Promise<PublicUser | null> {
  const attempt = () => fetch(urlFor('/auth/refresh'), { method: 'POST', credentials: 'include' });
  let res: Response | null = await attempt().catch(() => null);
  if (res === null || isUnavailable(res.status)) {
    // Probably a sleeping API, not a bad session: wake it, then try once more.
    await wakeApi();
    res = await attempt().catch(() => null);
  }
  if (res === null || !res.ok) return null;
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

/**
 * Only what's sent changes. An empty string clears `description` / `tripType`,
 * and a tag list replaces the whole list. Host-only, and only while the trip
 * is OPEN or FULL.
 */
export type UpdateTripInput = Partial<CreateTripInput>;

export function updateTrip(tripId: string, data: UpdateTripInput) {
  return apiFetch<Trip>(`/trips/${tripId}`, { method: 'PATCH', body: JSON.stringify(data) });
}

/** Host-only and irreversible: declines pending requests and notifies everyone on the trip. */
export function cancelTrip(tripId: string) {
  return apiFetch<Trip>(`/trips/${tripId}/cancel`, { method: 'POST' });
}

export interface DiscoverParams {
  budgetMin?: number;
  budgetMax?: number;
  startDate?: string;
  endDate?: string;
  destination?: string;
  limit?: number;
  /** How many results to skip — pass the number already shown to get the next page. */
  offset?: number;
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

// ---------- Members & expenses ----------

export interface TripMember {
  id: string;
  userId: string;
  role: MembershipRole;
  user: { id: string; name: string; trustScore: number };
}

/** Approved members only; the API rejects anyone who isn't one. */
export function listTripMembers(tripId: string) {
  return apiFetch<TripMember[]>(`/trips/${tripId}/members`);
}

export interface ExpenseUser {
  id: string;
  name: string;
  trustScore: number;
}

export interface ExpenseSplit {
  id: string;
  expenseId: string;
  userId: string;
  amount: number;
  settled: boolean;
  settledAt: string | null;
  user: ExpenseUser;
}

/** Amounts are whole units of the single launch currency — no minor units. */
export interface Expense {
  id: string;
  tripId: string;
  paidById: string;
  /** Who entered it; null for expenses logged before that was recorded. */
  createdById: string | null;
  description: string;
  amount: number;
  category: string | null;
  createdAt: string;
  paidBy: ExpenseUser;
  splits: ExpenseSplit[];
  /** Whether *you* may still edit or delete it: you logged or paid it, and no share is marked paid yet. */
  canChange: boolean;
}

export interface Balances {
  /** Positive `netAmount`: they owe you. Negative: you owe them. */
  balances: { counterpart: ExpenseUser; netAmount: number }[];
  totalOwedToYou: number;
  totalYouOwe: number;
}

export interface CreateExpenseInput {
  description: string;
  amount: number;
  paidById?: string;
  category?: string;
  /** Equal split across these people. Ignored when `splits` is given. */
  splitUserIds?: string[];
  /** Exact per-person amounts; must sum to `amount`. */
  splits?: { userId: string; amount: number }[];
}

export function listExpenses(tripId: string) {
  return apiFetch<Expense[]>(`/trips/${tripId}/expenses`);
}

export function createExpense(tripId: string, input: CreateExpenseInput) {
  return apiFetch<Expense>(`/trips/${tripId}/expenses`, { method: 'POST', body: JSON.stringify(input) });
}

/** Replaces the expense wholesale — same body as creating one. Leaving out who paid or who to split between keeps the current ones. */
export function updateExpense(tripId: string, expenseId: string, input: CreateExpenseInput) {
  return apiFetch<Expense>(`/trips/${tripId}/expenses/${expenseId}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteExpense(tripId: string, expenseId: string) {
  return apiFetch<{ id: string; deleted: true }>(`/trips/${tripId}/expenses/${expenseId}`, { method: 'DELETE' });
}

export function getBalances(tripId: string) {
  return apiFetch<Balances>(`/trips/${tripId}/balances`);
}

export function settleSplit(tripId: string, expenseId: string, splitId: string) {
  return apiFetch<ExpenseSplit>(`/trips/${tripId}/expenses/${expenseId}/splits/${splitId}/settle`, {
    method: 'PATCH',
  });
}

// ---------- Reviews & trust ----------

/** Host-only, and only once the trip's end date has passed. Irreversible — it opens reviews. */
export function completeTrip(tripId: string) {
  return apiFetch<Trip>(`/trips/${tripId}/complete`, { method: 'POST' });
}

export interface ReviewTarget {
  id: string;
  name: string;
  trustScore: number;
}

export interface ReceivedReview {
  id: string;
  tripId: string;
  reviewerId: string;
  revieweeId: string;
  reliability: number;
  friendliness: number;
  communication: number;
  cleanliness: number;
  comment: string | null;
  createdAt: string;
  processedAt: string | null;
  reviewer: ReviewTarget;
}

export interface CreateReviewInput {
  revieweeId: string;
  reliability: number;
  friendliness: number;
  communication: number;
  cleanliness: number;
  comment?: string;
}

/** People on the trip the caller hasn't reviewed yet. */
export function listPendingReviews(tripId: string) {
  return apiFetch<ReviewTarget[]>(`/trips/${tripId}/reviews/pending`);
}

/** Only reviews whose blind window has resolved — an unresolved one about you is never returned. */
export function listReceivedReviews(tripId: string) {
  return apiFetch<ReceivedReview[]>(`/trips/${tripId}/reviews/received`);
}

export function submitReview(tripId: string, input: CreateReviewInput) {
  return apiFetch<unknown>(`/trips/${tripId}/reviews`, { method: 'POST', body: JSON.stringify(input) });
}

export interface TrustEvent {
  id: string;
  delta: number;
  reason: string;
  resultingScore: number;
  tripId: string | null;
  /** The trip's title, or null if it has since been deleted (or the event has no trip). */
  tripTitle: string | null;
  createdAt: string;
}

/** The audit trail behind the caller's own trust score, newest first. */
export function listTrustEvents() {
  return apiFetch<TrustEvent[]>('/users/me/trust-events');
}

// ---------- Push notifications ----------

/** Not secret — it's what a browser needs to call `pushManager.subscribe()`. */
export function getVapidPublicKey() {
  return apiFetch<{ publicKey: string }>('/notifications/vapid-public-key');
}

/** The shape of the browser's `PushSubscription.toJSON()`. */
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function savePushSubscription(subscription: PushSubscriptionInput) {
  return apiFetch<unknown>('/notifications/subscribe', { method: 'POST', body: JSON.stringify(subscription) });
}

export function deletePushSubscription(endpoint: string) {
  return apiFetch<void>('/notifications/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) });
}

// ---------- Safety: blocking and reporting ----------

/** The reasons a report can give. Mirrors apps/api/src/safety/report-reasons.ts — keep the two in step. */
export const REPORT_REASONS = [
  { value: 'HARASSMENT', label: 'Harassment or threats' },
  { value: 'SAFETY_CONCERN', label: 'Made me feel unsafe' },
  { value: 'FAKE_PROFILE', label: 'Fake or misleading profile' },
  { value: 'INAPPROPRIATE_CONTENT', label: 'Inappropriate messages or content' },
  { value: 'SPAM', label: 'Spam or scams' },
  { value: 'NO_SHOW', label: "Didn't show up or bailed" },
  { value: 'OTHER', label: 'Something else' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['value'];

export interface ReportInput {
  reportedId: string;
  reason: ReportReason;
  details?: string;
  /** Optional; must be a trip you both were on. */
  tripId?: string;
}

/** Only people you've been on a trip with can be reported (the API enforces it). */
export function reportUser(input: ReportInput) {
  return apiFetch<{ id: string; createdAt: string }>('/reports', { method: 'POST', body: JSON.stringify(input) });
}

/**
 * Blocking is symmetric and total (BLUEPRINT §08): you stop seeing each other in
 * discovery, on trip pages, in travellers lists and in chat. Neither is told.
 */
export function blockUser(userId: string) {
  return apiFetch<void>(`/users/${userId}/block`, { method: 'POST' });
}

export function unblockUser(userId: string) {
  return apiFetch<void>(`/users/${userId}/block`, { method: 'DELETE' });
}

export interface BlockedUser {
  user: { id: string; name: string };
  createdAt: string;
}

/** The people *you* have blocked — never who has blocked you. */
export function listBlockedUsers() {
  return apiFetch<BlockedUser[]>('/users/me/blocks');
}

// ---------- Moderation (admins only) ----------

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DELETED';
export type ReportStatus = 'OPEN' | 'REVIEWING' | 'ACTIONED' | 'DISMISSED';

export interface AdminReport {
  id: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  createdAt: string;
  tripId: string | null;
  tripTitle: string | null;
  resolution: string | null;
  reviewedAt: string | null;
  reviewedBy: { id: string; name: string } | null;
  reporter: { id: string; name: string; trustScore: number };
  reported: { id: string; name: string; trustScore: number; accountStatus: AccountStatus };
  /** What a reviewer needs to judge one report in proportion to the rest. */
  context: { openReportsAgainstThem: number; distinctReportersAgainstThem: number; blockedByCount: number };
}

export interface RestrictedUser {
  id: string;
  name: string;
  trustScore: number;
  // A deleted account is never listed here: there's nothing left to reinstate.
  accountStatus: Exclude<AccountStatus, 'ACTIVE' | 'DELETED'>;
  lastDecision: { reason: string; createdAt: string; actor: { id: string; name: string } } | null;
}

/** Omit `status` for the open queue (OPEN and REVIEWING); pass ACTIONED or DISMISSED for history. */
export function listAdminReports(status?: ReportStatus) {
  return apiFetch<AdminReport[]>(`/admin/reports${status ? `?status=${status}` : ''}`);
}

/** A note is required to close a report (ACTIONED or DISMISSED). */
export function reviewAdminReport(
  reportId: string,
  input: { status: 'REVIEWING' | 'ACTIONED' | 'DISMISSED'; resolution?: string },
) {
  return apiFetch<{ id: string; status: ReportStatus }>(`/admin/reports/${reportId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/**
 * Suspend, ban or reinstate an account. The reason is always required — it goes
 * in the audit trail. Passing `reportId` closes that report as ACTIONED too.
 */
export function setAccountStatus(userId: string, input: { status: AccountStatus; reason: string; reportId?: string }) {
  return apiFetch<{ id: string; accountStatus: AccountStatus }>(`/admin/users/${userId}/status`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listRestrictedUsers() {
  return apiFetch<RestrictedUser[]>('/admin/users/restricted');
}

// ---------- Your data ----------

/** Everything the app holds about you, as one document to save as a file. */
export function exportMyData() {
  return apiFetch<Record<string, unknown>>('/users/me/export');
}

/** Proof it's you: the password, or — for an account that has none — its email address. */
export interface DeleteAccountInput {
  password?: string;
  confirmEmail?: string;
}

/** Irreversible. The server refuses while you host a trip that hasn't finished. */
export function deleteMyAccount(input: DeleteAccountInput) {
  return apiFetch<{ deleted: true }>('/users/me', { method: 'DELETE', body: JSON.stringify(input) });
}

// ---------- Password reset and email verification ----------

/** Always succeeds, whether or not the address has an account — so it can't be used to find out. */
export function requestPasswordReset(email: string) {
  return apiFetch<{ ok: true }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
}

/** `token` comes from the emailed link. Signs the account out everywhere. */
export function resetPassword(token: string, password: string) {
  return apiFetch<{ ok: true }>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
}

export function verifyEmailToken(token: string) {
  return apiFetch<{ ok: true }>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
}

/** For a signed-in person who didn't get, or lost, the first email. */
export function resendVerificationEmail() {
  return apiFetch<{ alreadyVerified: boolean }>('/auth/resend-verification', { method: 'POST' });
}
