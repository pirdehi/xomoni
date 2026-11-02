'use client';

import { useEffect, useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { countdown, secondsLeft, type PairingCode, type PairingResult } from '../domain/pairing';

/**
 * Connects a browser's extension to this account (ADR-0018): makes a one-time code on request and shows it with
 * its countdown, to type into the extension's Settings. The code only lets that extension report job status;
 * nothing here starts or changes work on X (ADR-0006).
 */
export function PairingPanel({ createCode }: { createCode: () => Promise<PairingResult> }) {
  const [code, setCode] = useState<PairingCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!code) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [code]);

  async function newCode() {
    setPending(true);
    setError(null);
    const result = await createCode();
    setPending(false);
    setNow(Date.now());
    if (result.ok) setCode(result.code);
    else setError(result.message);
  }

  const left = code ? secondsLeft(code, now) : 0;
  return (
    <div>
      {code && left > 0 ? (
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <p className="text-sm text-ink-2">Type this code in the extension, under Settings → xomoni.com:</p>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-widest" aria-label="Pairing code">
            {code.code}
          </p>
          <p className="mt-1 text-xs text-muted" role="timer">
            Works once, for {countdown(left)} more.
          </p>
        </div>
      ) : (
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void newCode()}>
          {code ? <RefreshCw className="size-4" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
          {code ? 'The code expired. Get a new one' : 'Get a code to connect a browser'}
        </button>
      )}
      {error && (
        <p className="mt-2 text-sm text-critical" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
