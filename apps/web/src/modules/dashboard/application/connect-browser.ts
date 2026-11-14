import { type ConnectOutcome, type ConnectRequest, PAIR_MESSAGE, parseExtensionAnswer } from '../domain/connect';
import type { DevicePairing, ExtensionLink } from './ports';

/**
 * Connects the browser whose extension asked (#228, ADR-0024): makes a one-time code for the signed-in person and
 * hands it to that extension with its nonce. The extension trades the code itself, as if typed (ADR-0018); this page
 * never sees a token. A failure to make the code keeps the database's message.
 */
export async function connectBrowser(
  deps: { pairing: DevicePairing; link: ExtensionLink },
  request: ConnectRequest,
): Promise<ConnectOutcome> {
  const made = await deps.pairing.createCode();
  if (!made.ok) return { ok: false, reason: 'code', message: made.message };
  try {
    const answer = await deps.link.send(request.extensionId, {
      type: PAIR_MESSAGE,
      code: made.code.code,
      nonce: request.nonce,
    });
    return parseExtensionAnswer(answer);
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}
