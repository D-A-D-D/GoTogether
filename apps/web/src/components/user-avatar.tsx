'use client';

import { useMediaUrl } from '@/lib/media';
import { avatarPath } from '@/lib/media-path';
import { Avatar } from '@/components/ui';

export interface AvatarUser {
  id: string;
  name: string;
  avatarUpdatedAt?: string | null;
}

/**
 * A person's picture if they have set one, otherwise their initials on their colour - and the initials
 * are also what shows while the picture is on its way, so there is never a blank circle.
 */
export function UserAvatar({ user, size = 40, className }: { user: AvatarUser; size?: number; className?: string }) {
  const { url } = useMediaUrl(avatarPath(user));
  if (!url) return <Avatar name={user.name} size={size} className={className} />;
  return (
    // A local blob address: Next's image optimiser has nothing to offer here.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" width={size} height={size} className={`shrink-0 rounded-full bg-surface-2 object-cover ${className ?? ''}`} style={{ width: size, height: size }} />
  );
}
