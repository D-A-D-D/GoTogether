'use client';

import { useEffect, useState } from 'react';

type Status = 'checking' | 'ok' | 'down';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function HealthStatus() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/health`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(() => {
        if (!cancelled) setStatus('ok');
      })
      .catch(() => {
        if (!cancelled) setStatus('down');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const label =
    status === 'checking' ? 'Checking API…' : status === 'ok' ? 'API connected' : 'API unreachable';
  const dotColor = status === 'ok' ? 'bg-emerald-500' : status === 'down' ? 'bg-red-500' : 'bg-foreground/30';

  return (
    <div className="flex items-center gap-2 rounded-full border border-foreground/10 px-4 py-2 text-sm">
      <span className={`h-2 w-2 rounded-full ${dotColor}`} aria-hidden />
      {label}
    </div>
  );
}
