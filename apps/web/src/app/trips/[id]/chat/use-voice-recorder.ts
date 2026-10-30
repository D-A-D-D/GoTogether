'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_VOICE_MS, pickRecorderMime } from '@/lib/voice';

export interface Recording {
  blob: Blob;
  durationMs: number;
}

export type RecorderState = 'idle' | 'starting' | 'recording';

/** How many recent loudness readings are kept for the live bars. */
const LEVEL_COUNT = 36;

function describeMicProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Allow microphone access in your browser to record a voice message.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found on this device.';
  if (name === 'NotReadableError') return 'The microphone is being used by something else.';
  return 'Could not start recording. Please try again.';
}

/**
 * Records a voice message from the microphone. start() asks permission and begins; finish() stops and hands
 * back the recording; cancel() throws it away. It always lets go of the microphone when it is done or the
 * screen is left - a microphone that stays on is the kind of thing people (rightly) hate.
 */
export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);

  /** Lets go of the microphone and everything listening to it. */
  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void audioContext.current?.close().catch(() => undefined);
    audioContext.current = null;
    analyser.current = null;
    recorder.current = null;
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Voice messages are not supported in this browser.');
      return false;
    }
    setState('starting');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      setError(describeMicProblem(err));
      setState('idle');
      return false;
    }

    try {
      const mimeType = pickRecorderMime((type) => MediaRecorder.isTypeSupported(type));
      // Speech needs little: about 32 kbit/s keeps a minute under a quarter of a megabyte.
      recorder.current = new MediaRecorder(stream.current, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : { audioBitsPerSecond: 32_000 });
      chunks.current = [];
      recorder.current.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      recorder.current.start(250);
    } catch {
      release();
      setError('Could not start recording. Please try again.');
      setState('idle');
      return false;
    }

    // A live loudness reading, for the bars. If the browser cannot provide one, recording still works.
    try {
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream.current);
      const node = context.createAnalyser();
      node.fftSize = 256;
      source.connect(node);
      audioContext.current = context;
      analyser.current = node;
    } catch {
      analyser.current = null;
    }

    startedAt.current = performance.now();
    setElapsedMs(0);
    setLevels([]);
    setState('recording');
    const samples = new Uint8Array(128);
    timer.current = setInterval(() => {
      setElapsedMs(Math.min(performance.now() - startedAt.current, MAX_VOICE_MS));
      if (analyser.current) {
        analyser.current.getByteTimeDomainData(samples);
        let peak = 0;
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
        setLevels((previous) => [...previous.slice(-(LEVEL_COUNT - 1)), Math.min(1, peak / 100)]);
      }
    }, 100);
    return true;
  }, [release]);

  /** Stops and returns what was recorded (null if nothing was). */
  const finish = useCallback(
    () =>
      new Promise<Recording | null>((resolve) => {
        const active = recorder.current;
        if (!active || active.state === 'inactive') {
          release();
          setState('idle');
          resolve(null);
          return;
        }
        const durationMs = Math.min(performance.now() - startedAt.current, MAX_VOICE_MS);
        active.onstop = () => {
          const blob = new Blob(chunks.current, { type: active.mimeType || 'audio/webm' });
          chunks.current = [];
          release();
          setState('idle');
          setElapsedMs(0);
          resolve(blob.size > 0 ? { blob, durationMs } : null);
        };
        active.stop();
      }),
    [release],
  );

  const cancel = useCallback(() => {
    const active = recorder.current;
    if (active && active.state !== 'inactive') {
      active.onstop = null;
      active.stop();
    }
    chunks.current = [];
    release();
    setState('idle');
    setElapsedMs(0);
  }, [release]);

  // Leaving the screen mid-recording must not leave the microphone on.
  useEffect(() => cancel, [cancel]);

  return { state, elapsedMs, levels, error, start, finish, cancel, clearError: () => setError(null) };
}
