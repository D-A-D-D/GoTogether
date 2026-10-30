// Voice messages: choosing a recording format the browser can make, and showing lengths. Pure, so testable;
// the recorder itself (microphone, MediaRecorder) lives in the chat screen's recorder component.

/** The longest voice message: matches what the server accepts, so a recording is stopped before it would be refused. */
export const MAX_VOICE_MS = 180_000;

/**
 * Formats that browsers can record, best first. Chrome and Firefox make WebM or Ogg with the Opus codec; Safari
 * (all iPhones) makes MP4. The server accepts all of these and works out which one it was from the bytes.
 */
export const RECORDER_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'] as const;

/** The first format `isSupported` says yes to, or undefined to let the browser choose its default. */
export function pickRecorderMime(isSupported: (mime: string) => boolean): string | undefined {
  return RECORDER_MIME_CANDIDATES.find((mime) => {
    try {
      return isSupported(mime);
    } catch {
      return false;
    }
  });
}

/** "0:07", "1:05", "12:30": how long a voice message is. Rounds down, never negative. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * A row of bar heights (0.15 to 1) for a voice message, decided by its id so the same message always looks the
 * same. A real waveform would mean decoding every message just to draw it; this is the honest cheap version.
 */
export function waveformBars(seed: string, count = 28): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const unit = ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    bars.push(Math.round((0.15 + unit * 0.85) * 100) / 100);
  }
  return bars;
}
