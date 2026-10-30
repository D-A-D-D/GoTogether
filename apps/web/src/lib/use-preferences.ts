'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  DEFAULT_PREFERENCES,
  applyPreferences,
  readPreferences,
  writePreferences,
  type Preferences,
} from '@/lib/preferences';

// Device preferences (theme, text size, motion) as a tiny store, so every control that shows or changes
// them stays in step, and the page itself (the attributes on <html>) changes the instant one does.

let current: Preferences | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function snapshot(): Preferences {
  if (!current) current = readPreferences(storage());
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreferences(): [Preferences, (change: Partial<Preferences>) => void] {
  // The server and the first client render use the defaults, so what was saved cannot cause a mismatch.
  const preferences = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_PREFERENCES);
  const update = useCallback((change: Partial<Preferences>) => {
    current = { ...snapshot(), ...change };
    writePreferences(storage(), current);
    applyPreferences(current);
    listeners.forEach((notify) => notify());
  }, []);
  return [preferences, update];
}

function subscribeToDevice(listener: () => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

/** Whether the screen is actually dark right now: the person's choice if they made one, else their device's. */
export function useIsDark(): boolean {
  const [preferences] = usePreferences();
  const deviceIsDark = useSyncExternalStore(
    subscribeToDevice,
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    () => false,
  );
  return preferences.theme === 'system' ? deviceIsDark : preferences.theme === 'dark';
}
