'use client';

import { useEffect } from 'react';
import { IconClose } from '@/components/icons';

/** A picture shown large, over everything. Press Escape, the close button or the dark area to leave. */
export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // The page behind should not scroll while a picture is open.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Photo" onClick={onClose} className="pop-in fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3 sm:p-8">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob address */}
      <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full rounded-lg object-contain" />
      <button
        type="button"
        autoFocus
        aria-label="Close photo"
        onClick={onClose}
        className="pressable absolute right-3 top-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/25 backdrop-blur hover:bg-white/25"
      >
        <IconClose size={26} />
      </button>
    </div>
  );
}
