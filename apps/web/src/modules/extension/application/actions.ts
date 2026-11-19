import type { ActionAnswer } from '@xomoni/bridge';
import type { XomoniRequest } from '../domain/presence';
import type { ActionChannel, BrowserMemory } from './ports';

/** What `askXomoni` needs: the extension in this browser, and its id as the site remembered it. */
export interface ActionDeps {
  channel: ActionChannel;
  memory: Pick<BrowserMemory, 'extensionId'>;
}

/**
 * Hands one request to Xomoni in this browser (ADR-0027, #251) and returns its answer. Without a known extension id
 * nothing is sent and the answer is `no_answer`. Nothing here can start work on X: the extension only stops jobs,
 * opens its pages, or asks the person to resume.
 */
export async function askXomoni(deps: ActionDeps, request: XomoniRequest): Promise<ActionAnswer> {
  const extensionId = deps.memory.extensionId();
  if (!extensionId) return { ok: false, reason: 'no_answer' };
  return request.kind === 'job'
    ? deps.channel.job(extensionId, { action: request.action, deviceId: request.deviceId, jobId: request.jobId })
    : deps.channel.open(extensionId, { page: request.page, deviceId: request.deviceId });
}
