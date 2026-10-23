'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import * as api from '@/lib/api';
import type { PublicUser } from '@/lib/api';
import { detachPushForLogout, syncPushForUser } from '@/lib/push';

type Status = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: PublicUser | null;
  status: Status;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Used by the OAuth callback page, which already has a token from the redirect fragment. */
  completeWithToken: (token: string) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const userId = user?.id ?? null;

  // Whenever someone is signed in, reconcile this device's push subscription
  // with them: drop one that isn't theirs, restore the one they opted into
  // here. Keyed on the id so a profile edit (a new `user` object) doesn't rerun it.
  useEffect(() => {
    if (userId) void syncPushForUser(userId).catch(() => undefined);
  }, [userId]);

  useEffect(() => {
    api.onSessionExpired(() => {
      setUser(null);
      setStatus('unauthenticated');
    });
  }, []);

  // Silent refresh on first load — the httpOnly cookie is the only thing
  // that survives a page reload; the access token itself lives only in memory.
  useEffect(() => {
    api
      .refreshSession()
      .then((refreshedUser) => {
        if (refreshedUser) {
          setUser(refreshedUser);
          setStatus('authenticated');
        } else {
          setStatus('unauthenticated');
        }
      })
      .catch(() => setStatus('unauthenticated'));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user: loggedInUser, accessToken } = await api.login(email, password);
    api.setAccessToken(accessToken);
    setUser(loggedInUser);
    setStatus('authenticated');
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const { user: newUser, accessToken } = await api.registerAccount(email, password, name);
    api.setAccessToken(accessToken);
    setUser(newUser);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    // First, while the session can still authenticate the request: stop this
    // device receiving the user's notifications once they've logged out.
    // (Who opted in is remembered, so they get them back quietly on return.)
    await detachPushForLogout().catch(() => undefined);
    await api.logout().catch(() => undefined);
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const completeWithToken = useCallback(async (token: string) => {
    api.setAccessToken(token);
    const me = await api.getMe();
    setUser(me);
    setStatus('authenticated');
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await api.getMe();
    setUser(me);
  }, []);

  return (
    <AuthContext.Provider value={{ user, status, login, register, logout, completeWithToken, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
