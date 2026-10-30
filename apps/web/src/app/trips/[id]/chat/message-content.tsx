'use client';

import { useEffect, useRef, useState } from 'react';
import type { MessageMedia } from '@/lib/api';
import { loadMedia, useMediaUrl } from '@/lib/media';
import { formatDuration, waveformBars } from '@/lib/voice';
import { Lightbox } from '@/components/lightbox';
import { IconPause, IconPlay } from '@/components/icons';
import { Skeleton } from '@/components/ui';

/** Pictures are shown in a box this wide; a very wide or tall one is cropped to a sensible shape in the chat (and whole when opened). */
const PICTURE_WIDTH = 'w-[min(16rem,68vw)]';
const MIN_RATIO = 0.62;
const MAX_RATIO = 1.8;

/** A picture in a message. Reserves its space from the first moment, so the chat does not jump as pictures arrive. */
export function ChatImage({ media, caption }: { media: MessageMedia; caption: string }) {
  const { url, failed } = useMediaUrl(`/media/${media.id}`);
  const [open, setOpen] = useState(false);
  const ratio = media.width && media.height ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, media.width / media.height)) : 1.33;

  if (failed) {
    return (
      <div className={`${PICTURE_WIDTH} flex items-center justify-center rounded-2xl bg-surface-2 p-4 text-center text-[0.9rem] text-muted`} style={{ aspectRatio: String(ratio) }}>
        This picture is not available.
      </div>
    );
  }
  if (!url) return <Skeleton className={`${PICTURE_WIDTH} !rounded-2xl`} />;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${PICTURE_WIDTH} block overflow-hidden rounded-2xl`} style={{ aspectRatio: String(ratio) }} aria-label={caption ? `Open picture: ${caption}` : 'Open picture'}>
        {/* A local blob address: Next's image optimiser has nothing to offer here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={caption || 'A picture sent in the chat'} className="h-full w-full object-cover" />
      </button>
      {open && <Lightbox src={url} alt={caption || 'A picture sent in the chat'} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Only one voice message plays at a time: starting one stops the other. */
let nowPlaying: HTMLAudioElement | null = null;

const RATES = [1, 1.5, 2] as const;

/** A voice message: play or pause, bars that fill as it plays, its length, and a speed button. */
export function VoicePlayer({ media, mine }: { media: MessageMedia; mine: boolean }) {
  const element = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const bars = waveformBars(media.id);
  const totalMs = media.durationMs ?? 0;

  // Leaving the screen (or this message scrolling away for good) silences it.
  useEffect(
    () => () => {
      element.current?.pause();
      if (nowPlaying === element.current) nowPlaying = null;
    },
    [],
  );

  async function ensureLoaded(): Promise<HTMLAudioElement | null> {
    if (element.current) return element.current;
    setState('loading');
    try {
      const audio = new Audio(await loadMedia(`/media/${media.id}`));
      audio.preload = 'auto';
      audio.addEventListener('play', () => setState('playing'));
      audio.addEventListener('pause', () => setState('paused'));
      audio.addEventListener('ended', () => {
        setState('idle');
        setProgress(0);
        audio.currentTime = 0;
      });
      audio.addEventListener('timeupdate', () => {
        // A recording made in the browser often reports no length until it has finished playing,
        // so the length stored with the message is what progress is measured against.
        const length = totalMs > 0 ? totalMs / 1000 : Number.isFinite(audio.duration) ? audio.duration : 0;
        setProgress(length > 0 ? Math.min(1, audio.currentTime / length) : 0);
      });
      audio.addEventListener('error', () => setState('error'));
      element.current = audio;
      return audio;
    } catch {
      setState('error');
      return null;
    }
  }

  async function toggle() {
    if (state === 'playing') {
      element.current?.pause();
      return;
    }
    const audio = await ensureLoaded();
    if (!audio) return;
    if (nowPlaying && nowPlaying !== audio) nowPlaying.pause();
    nowPlaying = audio;
    audio.playbackRate = rate;
    await audio.play().catch(() => setState('error'));
  }

  function cycleRate() {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (element.current) element.current.playbackRate = next;
  }

  const filled = Math.round(progress * bars.length);
  const shownMs = state === 'playing' || state === 'paused' ? Math.max(0, totalMs * (1 - progress)) : totalMs;
  const strong = mine ? 'bg-on-accent' : 'bg-accent';
  const faint = mine ? 'bg-on-accent/35' : 'bg-accent/30';

  return (
    <div className="flex w-[min(15rem,64vw)] items-center gap-3">
      <button
        type="button"
        onClick={toggle}
        disabled={state === 'loading'}
        aria-label={state === 'playing' ? 'Pause voice message' : 'Play voice message'}
        className={`pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${mine ? 'bg-on-accent text-accent' : 'bg-accent text-on-accent'} disabled:opacity-60`}
      >
        {state === 'playing' ? <IconPause size={22} /> : <IconPlay size={22} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex h-8 items-center gap-[2px]" aria-hidden="true">
          {bars.map((height, i) => (
            <span key={i} className={`w-[3px] flex-1 rounded-full ${i < filled ? strong : faint}`} style={{ height: `${Math.round(height * 100)}%` }} />
          ))}
        </div>
        <p className="mt-0.5 text-[0.8rem] tabular-nums opacity-80">{state === 'error' ? 'Could not play' : formatDuration(shownMs)}</p>
      </div>
      <button
        type="button"
        onClick={cycleRate}
        aria-label={`Playback speed ${rate} times. Press to change.`}
        className={`pressable h-8 shrink-0 rounded-full px-2 text-[0.8rem] font-bold tabular-nums ${mine ? 'bg-on-accent/20' : 'bg-accent/15'}`}
      >
        {rate}×
      </button>
    </div>
  );
}
