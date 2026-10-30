// Device preferences: how the app looks on this phone or computer - theme, text size, motion. They
// live in the browser (localStorage), not on the server: a person can reasonably want dark on their
// phone and light on a laptop. Privacy choices that other people can feel (read receipts) are different
// and live on the account.
//
// The pure parts are here so they can be tested; the browser parts are applyPreferences() and the tiny
// script in layout.tsx that runs before the first paint, so there is no flash of the wrong theme.

export type ThemeChoice = 'system' | 'light' | 'dark';
export type TextSize = 'standard' | 'large' | 'xlarge';

export interface Preferences {
  theme: ThemeChoice;
  textSize: TextSize;
  reduceMotion: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { theme: 'system', textSize: 'standard', reduceMotion: false };

export const STORAGE_KEYS = { theme: 'gt_theme', text: 'gt_text', motion: 'gt_motion' } as const;

export const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'Match my device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export const TEXT_SIZES: { value: TextSize; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'large', label: 'Large' },
  { value: 'xlarge', label: 'Extra large' },
];

export const normalizeTheme = (value: unknown): ThemeChoice => (value === 'light' || value === 'dark' ? value : 'system');
export const normalizeTextSize = (value: unknown): TextSize => (value === 'large' || value === 'xlarge' ? value : 'standard');

/** The attributes <html> should carry for a set of preferences. A missing one means "the default". */
export function htmlAttributes(p: Preferences): { 'data-theme'?: string; 'data-text'?: string; 'data-motion'?: string } {
  return {
    ...(p.theme !== 'system' ? { 'data-theme': p.theme } : {}),
    ...(p.textSize !== 'standard' ? { 'data-text': p.textSize } : {}),
    ...(p.reduceMotion ? { 'data-motion': 'reduce' } : {}),
  };
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Reads the saved preferences. Never throws: private windows and blocked storage fall back to the defaults. */
export function readPreferences(store: Store | null): Preferences {
  try {
    if (!store) return DEFAULT_PREFERENCES;
    return {
      theme: normalizeTheme(store.getItem(STORAGE_KEYS.theme)),
      textSize: normalizeTextSize(store.getItem(STORAGE_KEYS.text)),
      reduceMotion: store.getItem(STORAGE_KEYS.motion) === 'reduce',
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** Saves the preferences; a default is stored as absence, so clearing is the same as never having set. */
export function writePreferences(store: Store | null, p: Preferences): void {
  try {
    if (!store) return;
    const set = (key: string, value: string | null) => (value === null ? store.removeItem(key) : store.setItem(key, value));
    set(STORAGE_KEYS.theme, p.theme === 'system' ? null : p.theme);
    set(STORAGE_KEYS.text, p.textSize === 'standard' ? null : p.textSize);
    set(STORAGE_KEYS.motion, p.reduceMotion ? 'reduce' : null);
  } catch {
    // The choice still applies for this visit; it just will not be remembered.
  }
}

/**
 * The script that runs before the page paints (layout.tsx). Kept here, next to the rules it must match,
 * and written without any syntax that could break inside an HTML script tag.
 */
export const BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=localStorage;var t=s.getItem('${STORAGE_KEYS.theme}');if(t==='light'||t==='dark')d.setAttribute('data-theme',t);var x=s.getItem('${STORAGE_KEYS.text}');if(x==='large'||x==='xlarge')d.setAttribute('data-text',x);if(s.getItem('${STORAGE_KEYS.motion}')==='reduce')d.setAttribute('data-motion','reduce')}catch(e){}})();`;

/** Applies preferences to the page right now (used when someone changes one in Settings). */
export function applyPreferences(p: Preferences, root: HTMLElement = document.documentElement): void {
  for (const attribute of ['data-theme', 'data-text', 'data-motion']) root.removeAttribute(attribute);
  for (const [name, value] of Object.entries(htmlAttributes(p))) root.setAttribute(name, value as string);
}
