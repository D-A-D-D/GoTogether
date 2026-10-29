import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False while the page is server-rendered HTML that React hasn't taken over yet, true after.
 * Forms that carry a password keep their submit button disabled until then: before it, pressing
 * Enter makes the browser submit the form itself - a GET to the same page, which puts the email
 * and password in the address bar, the history and any server log.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
