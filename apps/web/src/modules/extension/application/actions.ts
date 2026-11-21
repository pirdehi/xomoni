import type { ActionAnswer, ReadAnswer, ReadMessage, SettingsAnswer, SettingsMessage } from '@xomoni/bridge';
import type { XomoniRequest } from '../domain/presence';
import type { ActionChannel, BrowserMemory, DistributiveOmit } from './ports';

/** What `askXomoni` needs: the extension in this browser, and its id. */
export interface ActionDeps {
  channel: ActionChannel;
  /**
   * The id to talk to Xomoni at: where the page's last sync found it answering (a store's fixed id included, #302),
   * else the one the site remembered.
   */
  memory: Pick<BrowserMemory, 'extensionId'>;
}

/**
 * Hands one request to Xomoni in this browser (ADR-0027, #251) and returns its answer. Without a known extension id
 * nothing is sent and the answer is `no_answer`. Nothing here can start work on X: the extension only stops jobs,
 * opens its pages, asks the person to resume, or fills in its Cleanup page for the person to review (#235).
 */
export async function askXomoni(deps: ActionDeps, request: XomoniRequest): Promise<ActionAnswer> {
  const extensionId = deps.memory.extensionId();
  if (!extensionId) return { ok: false, reason: 'no_answer' };
  switch (request.kind) {
    case 'job':
      return deps.channel.job(extensionId, {
        action: request.action,
        deviceId: request.deviceId,
        jobId: request.jobId,
      });
    case 'open':
      return deps.channel.open(extensionId, { page: request.page, deviceId: request.deviceId });
    case 'plan':
      return deps.channel.plan(extensionId, { plan: request.plan, deviceId: request.deviceId });
  }
}

/** A read of one of Xomoni's places, as a page asks it (ADR-0028). */
export type XomoniRead = DistributiveOmit<ReadMessage, 'type'>;

/**
 * Reads one of Xomoni's places in this browser (ADR-0028, #233): the answer is X content, for the page that asked and
 * nowhere else. Without a known extension id nothing is sent and the answer is `no_answer`.
 */
export async function readXomoni(deps: ActionDeps, read: XomoniRead): Promise<ReadAnswer> {
  const extensionId = deps.memory.extensionId();
  if (!extensionId) return { ok: false, reason: 'no_answer' };
  return deps.channel.read(extensionId, read);
}

/** A change of Xomoni's settings, as a page asks it (ADR-0029). */
export type XomoniSettingsChange = Omit<SettingsMessage, 'type'>;

/**
 * Asks Xomoni in this browser to change some of its settings (ADR-0029, #234). Xomoni checks and clamps every value
 * with its own rules and answers the settings as stored. Without a known extension id nothing is sent and the answer
 * is `no_answer`.
 */
export async function changeXomoniSettings(deps: ActionDeps, change: XomoniSettingsChange): Promise<SettingsAnswer> {
  const extensionId = deps.memory.extensionId();
  if (!extensionId) return { ok: false, reason: 'no_answer' };
  return deps.channel.settings(extensionId, change);
}
