'use client';

import { useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { AVATAR_IMAGE, prepareImage, UnsupportedImageError } from '@/lib/image';
import { ApiError, removeAvatar, uploadAvatar } from '@/lib/api';
import { invalidateQueries } from '@/lib/query';
import { ErrorText } from '@/components/form-controls';
import { Button } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { IconCamera } from '@/components/icons';

/**
 * The signed-in person's profile picture, with a camera button to change it and a way to remove it.
 * The chosen photo is cropped square and shrunk in the browser before it is sent, so a 12-megapixel phone
 * photo becomes a small file in a moment.
 */
export function AvatarPicker({ size = 92 }: { size?: number }) {
  const { user, refreshUser } = useAuth();
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  /** The picture appears in feeds, chats and lists: all of them are now out of date. */
  async function changed() {
    await refreshUser();
    invalidateQueries('me', 'discover:', 'trips:', 'trip:');
  }

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const { blob } = await prepareImage(file, AVATAR_IMAGE);
      await uploadAvatar(blob);
      await changed();
    } catch (err) {
      setError(
        err instanceof UnsupportedImageError || err instanceof ApiError
          ? err.message
          : 'Could not set your photo. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setError(null);
    setBusy(true);
    try {
      await removeAvatar();
      await changed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove your photo. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="relative">
        <UserAvatar user={user} size={size} />
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          aria-label={user.avatarUpdatedAt ? 'Change your profile photo' : 'Add a profile photo'}
          className="pressable absolute -bottom-1 -right-1 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-on-accent shadow ring-4 ring-background disabled:opacity-60"
        >
          <IconCamera size={20} />
        </button>
        {busy && (
          <span role="status" className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-[0.8rem] font-semibold text-white">
            Saving…
          </span>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // so choosing the same file again still counts
            if (file) void handleFile(file);
          }}
        />
      </div>
      {user.avatarUpdatedAt && !busy && (
        <Button variant="ghost" size="sm" onClick={handleRemove} className="-ml-3 !text-muted">
          Remove photo
        </Button>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
