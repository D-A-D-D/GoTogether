'use client';

import { useState } from 'react';
import { EMOJI_CATEGORIES, pushRecent } from '@/lib/emoji-data';

const RECENT_KEY = 'gt_emoji_recent';

function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string').slice(0, 24) : [];
  } catch {
    return [];
  }
}

function saveRecent(recent: string[]): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // Private windows and blocked storage: the picker just will not remember.
  }
}

/**
 * A small emoji keyboard: tabs for a handful of groups, and the ones used lately first. Buttons keep the
 * message box focused (they take the press, not the focus), so the caret stays where it was.
 */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const tabs = [
    ...(recent.length > 0 ? [{ id: 'recent', label: 'Recently used', icon: '🕘', emojis: recent }] : []),
    ...EMOJI_CATEGORIES,
  ];
  const [active, setActive] = useState(tabs[0].id);
  const shown = tabs.find((t) => t.id === active) ?? tabs[0];

  function pick(emoji: string) {
    const next = pushRecent(recent, emoji);
    setRecent(next);
    saveRecent(next);
    onPick(emoji);
  }

  return (
    <div className="pop-in border-t border-line bg-surface" role="group" aria-label="Emoji">
      <div className="no-scrollbar flex gap-1 overflow-x-auto px-2 pt-2" role="tablist" aria-label="Emoji groups">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === shown.id}
            aria-label={tab.label}
            title={tab.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setActive(tab.id)}
            className={`pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl ${tab.id === shown.id ? 'bg-accent-soft ring-2 ring-accent' : 'hover:bg-surface-2'}`}
          >
            {tab.icon}
          </button>
        ))}
      </div>
      <p className="px-4 pt-1.5 text-[0.85rem] font-semibold text-muted">{shown.label}</p>
      <div className="grid max-h-40 grid-cols-7 gap-0.5 overflow-y-auto overscroll-contain px-2 pb-2 pt-1 sm:grid-cols-10">
        {shown.emojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(emoji)}
            className="pressable flex h-11 items-center justify-center rounded-lg text-[1.65rem] hover:bg-surface-2"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
