import type { DailyNumbers, Device, JobSummary } from '../domain/model';
import type { PairMessage } from '../domain/connect';
import type { PairingResult } from '../domain/pairing';

/** Reads the signed-in person's devices and recent jobs. Row Level Security scopes every read. */
export interface DashboardReader {
  /** Devices, most recently seen first. */
  listDevices(): Promise<Device[]>;
  /** Jobs, most recently updated first. */
  listRecentJobs(limit: number): Promise<JobSummary[]>;
  /** Daily numbers from `since` (`YYYY-MM-DD`) on, oldest first; none while they are off (#250). */
  listDailyNumbers(since: string): Promise<DailyNumbers[]>;
}

/** Changes to the signed-in person's devices. */
export interface DeviceRegistry {
  /** Disconnects a device; its job summaries go with it. */
  disconnect(deviceId: string): Promise<{ ok: true } | { ok: false; message: string }>;
}

/** Callbacks for live changes. */
export interface LiveHandlers {
  /** A job was created or updated. */
  onJob(job: JobSummary): void;
  /** A device was added or reported in. */
  onDevice(device: Device): void;
  /** The live feed connected (`true`) or dropped (`false`). */
  onStatus(live: boolean): void;
}

/** Pushes changes as they happen. */
export interface LiveFeed {
  /** Starts listening for the viewer's rows; returns a function that stops listening. */
  subscribe(viewerId: string, handlers: LiveHandlers): () => void;
}

/** Whether the signed-in account shows its daily numbers on xomoni.com (#250, ADR-0026). */
export interface NumbersChoice {
  /** The stored choice; false until the person turns it on. */
  get(): Promise<boolean>;
  /** Turns them on or off; off deletes every day already sent. Resolves with the stored choice. */
  set(enabled: boolean): Promise<boolean>;
}

/** Whether the signed-in account gets the weekly email of its numbers (#257, ADR-0031). */
export interface WeeklyEmailChoice {
  /** The stored choice; false until the person turns it on. */
  get(): Promise<boolean>;
  /** Turns it on (only while the daily numbers are on) or off. Resolves with the stored choice. */
  set(enabled: boolean): Promise<boolean>;
}

/** One-time codes that connect a browser's extension to the signed-in account (ADR-0018). */
export interface DevicePairing {
  /** A new code, replacing any earlier one; it works once, for ten minutes. */
  createCode(): Promise<PairingResult>;
}

/** The Xomoni extension in this browser, reached from xomoni.com's pages (`externally_connectable`, ADR-0024). */
export interface ExtensionLink {
  /** Sends `message` to the extension `extensionId` and resolves with its answer; rejects when it can't be reached. */
  send(extensionId: string, message: PairMessage): Promise<unknown>;
}
