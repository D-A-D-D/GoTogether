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

/** Uses the httpOnly refresh cookie (path-scoped to /auth) — never touches JS-readable storage. */
export async function refreshSession(): Promise<PublicUser | null> {
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
