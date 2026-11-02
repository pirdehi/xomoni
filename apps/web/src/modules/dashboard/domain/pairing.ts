/** A one-time code that connects a browser's extension to the signed-in account (ADR-0018). */
export interface PairingCode {
  /** Ten Crockford base-32 characters as `XXXXX-XXXXX`; the extension accepts it in any case, with or without the dash. */
  code: string;
  /** When the code stops working (ISO 8601); ten minutes after it was made. */
  expiresAt: string;
}

/** A new code, or why there is none (a message safe to show). */
export type PairingResult = { ok: true; code: PairingCode } | { ok: false; message: string };

/** Whole seconds until `code` stops working at `now` (epoch ms); 0 once it has. */
export function secondsLeft(code: PairingCode, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(code.expiresAt) - now) / 1000));
}

/** `seconds` as `m:ss` for the countdown next to a code. */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
