// The emoji picker's contents. Deliberately a short, hand-picked list - the faces, hands, hearts and trip things
// people actually send - rather than the thousands in the full set, which would be a large dependency and a
// long scroll. Each entry is one emoji (the test checks, so a typo that glues two together fails).

export interface EmojiCategory {
  id: string;
  label: string;
  /** The emoji shown on the category's tab. */
  icon: string;
  emojis: string[];
}

const words = (text: string) => text.split(/\s+/).filter(Boolean);

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    icon: '😀',
    emojis: words(
      '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😍 🥰 😘 😋 😛 😜 🤪 🤗 🤔 🤨 😐 😑 😶 🙄 😏 😮 😲 😴 😪 🤤 😷 🤒 🥵 🥶 😎 🤩 🥳 😭 😢 😤 😠 😡 🤯 😱 😨 😰 🥺 😳 🤭 🤫 🫡 😬 😌 🤓',
    ),
  },
  {
    id: 'people',
    label: 'Hands and hearts',
    icon: '👍',
    emojis: words('👍 👎 👏 🙌 🙏 🤝 💪 ✌️ 🤞 👌 🤟 🤙 👋 ✋ 👀 🧠 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💖 ✨ 🔥 💯 🎉 🎊 🥂 🫶 🤌 👊 🙈 🙉 🙊'),
  },
  {
    id: 'travel',
    label: 'Travel',
    icon: '✈️',
    emojis: words(
      '✈️ 🚗 🚕 🚌 🚆 🚲 🛵 ⛵ 🚢 🏖️ 🏝️ ⛰️ 🏔️ 🌋 🏕️ 🗺️ 🧭 🎒 🧳 📸 🌅 🌄 🌇 🌃 🌉 🏯 🛕 🕌 ⛩️ 🗼 🎡 🛖 🏨 🚂 🛶 🪂 🛺 ⛺',
    ),
  },
  {
    id: 'food',
    label: 'Food and drink',
    icon: '🍜',
    emojis: words(
      '☕ 🍵 🍺 🍷 🍹 🥤 🍕 🍔 🍟 🌮 🌯 🥗 🍜 🍛 🍣 🍱 🥘 🍲 🍚 🍞 🧀 🥐 🍰 🍦 🍩 🍪 🍫 🍎 🍌 🍉 🍇 🥭 🥥 🍍 🌶️ 🫓 🥟 🍿',
    ),
  },
  {
    id: 'nature',
    label: 'Weather and nature',
    icon: '🌈',
    emojis: words('🌞 🌙 ⭐ 🌈 ☀️ ⛅ 🌧️ ⛈️ ❄️ 🌊 🌴 🌵 🌳 🌲 🍃 🌸 🌺 🌻 🐶 🐱 🐘 🐯 🦁 🐒 🦜 🐢 🐬 🦋 🐄 🦚'),
  },
  {
    id: 'activities',
    label: 'Fun',
    icon: '🎶',
    emojis: words('⚽ 🏏 🏸 🎾 🏄 🤿 🧗 🥾 🚣 🏊 🎶 🎵 🎸 🎤 🎬 🎲 🎯 🏆 🪁 🎈 🎁 🛍️'),
  },
  {
    id: 'objects',
    label: 'Things and signs',
    icon: '📍',
    emojis: words('💡 📍 📌 💰 💳 🧾 ⏰ 📅 📱 🔋 🔦 🧴 🩹 ☂️ ✅ ❌ ❓ ❗ ⚠️ 🚫 ➕ ➡️ 🔔 🔒'),
  },
];

/** How many "recent" emoji are kept. */
export const RECENT_LIMIT = 24;

/** Adds an emoji to the front of the recent list, without duplicates, keeping at most `limit`. */
export function pushRecent(recent: readonly string[], emoji: string, limit = RECENT_LIMIT): string[] {
  return [emoji, ...recent.filter((e) => e !== emoji)].slice(0, limit);
}

/** Puts `text` into `value` at the caret (or over a selection), and says where the caret then is. */
export function insertAt(value: string, text: string, start: number, end: number): { value: string; caret: number } {
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  return { value: value.slice(0, from) + text + value.slice(to), caret: from + text.length };
}
