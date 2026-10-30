// Where protected pictures live. Kept apart from lib/media.ts (which fetches them) so it has no imports and can be tested.

/** The address of someone's profile picture, or null if they have none. The version makes a changed picture a new address. */
export function avatarPath(user: { id: string; avatarUpdatedAt?: string | null }): string | null {
  return user.avatarUpdatedAt ? `/users/${user.id}/avatar?v=${encodeURIComponent(user.avatarUpdatedAt)}` : null;
}
