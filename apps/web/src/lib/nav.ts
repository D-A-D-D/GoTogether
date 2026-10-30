// What the app chrome needs to know about each screen: its title, where "back" goes when there is
// no history to go back through (someone arriving from a link or a notification), and whether it
// is one of the main tabs. Pure, so it is testable.

export interface RouteMeta {
  title: string;
  /** Where Back goes if the person has nowhere in the app to go back to. Null on the main tabs. */
  back: string | null;
  /** One of the four main tabs: no Back button, the tab bar shows. */
  tab: boolean;
  /** A full-screen conversation: the tab bar steps out of the way. */
  immersive: boolean;
}

const PLAIN = { tab: false, immersive: false } as const;

const FIXED: Record<string, RouteMeta> = {
  '/': { title: '', back: null, tab: true, immersive: false },
  '/trips/discover': { title: 'Discover', back: null, tab: true, immersive: false },
  '/trips/mine': { title: 'My trips', back: null, tab: true, immersive: false },
  '/profile': { title: 'Profile', back: null, tab: true, immersive: false },
  '/trips/new': { title: 'Host a trip', back: '/trips/discover', ...PLAIN },
  '/admin': { title: 'Admin', back: '/profile', ...PLAIN },
  '/login': { title: 'Log in', back: '/', ...PLAIN },
  '/register': { title: 'Sign up', back: '/', ...PLAIN },
  '/forgot-password': { title: 'Reset password', back: '/login', ...PLAIN },
  '/reset-password': { title: 'New password', back: '/login', ...PLAIN },
  '/verify-email': { title: 'Confirm email', back: '/', ...PLAIN },
  '/account-deleted': { title: '', back: '/', ...PLAIN },
  '/terms': { title: 'Terms of use', back: '/', ...PLAIN },
  '/privacy': { title: 'Privacy policy', back: '/', ...PLAIN },
  '/auth/callback': { title: '', back: '/', ...PLAIN },
};

const TRIP_PAGE = /^\/trips\/([^/]+)(?:\/(chat|expenses|reviews|edit))?$/;

const TRIP_SECTIONS: Record<string, { title: string; immersive: boolean }> = {
  chat: { title: 'Trip chat', immersive: true },
  expenses: { title: 'Expenses', immersive: false },
  reviews: { title: 'Reviews', immersive: false },
  edit: { title: 'Edit trip', immersive: false },
};

export function routeMeta(pathname: string): RouteMeta {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const fixed = FIXED[path];
  if (fixed) return fixed;

  const trip = TRIP_PAGE.exec(path);
  if (trip) {
    const [, id, section] = trip;
    if (!section) return { title: 'Trip', back: '/trips/discover', ...PLAIN };
    const { title, immersive } = TRIP_SECTIONS[section];
    return { title, back: `/trips/${id}`, tab: false, immersive };
  }
  return { title: '', back: '/', ...PLAIN };
}

/** Which main tab a path belongs to, so a trip's page still lights up "My trips" or "Discover" sensibly. */
export function activeTab(pathname: string): 'discover' | 'mine' | 'new' | 'profile' | null {
  if (pathname === '/trips/discover') return 'discover';
  if (pathname === '/trips/mine') return 'mine';
  if (pathname === '/trips/new') return 'new';
  if (pathname === '/profile' || pathname === '/admin') return 'profile';
  return null;
}

/**
 * A stack of the screens visited in this session, kept in step with the browser's own history, so
 * Back can tell "there is a previous screen in the app" (go back, which also restores scroll) from
 * "this is where they landed" (go to the screen's parent instead of leaving the app).
 */
export function createVisitStack() {
  const stack: string[] = [];
  let popping = false;
  return {
    /** The browser went back or forward by itself: the next path change should not be treated as a push. */
    markPop() {
      popping = true;
    },
    /** Call whenever the path changes. */
    visit(path: string) {
      if (stack[stack.length - 1] === path) return;
      if (popping) {
        popping = false;
        const at = stack.lastIndexOf(path);
        if (at !== -1) {
          stack.length = at + 1; // went back to a screen we know
          return;
        }
      }
      stack.push(path);
    },
    canGoBack: () => stack.length > 1,
    depth: () => stack.length,
  };
}
