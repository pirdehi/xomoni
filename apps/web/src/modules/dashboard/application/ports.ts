import type { Device, JobSummary } from '../domain/model';

/** Reads the signed-in person's devices and recent jobs. Row Level Security scopes every read. */
export interface DashboardReader {
  /** Devices, most recently seen first. */
  listDevices(): Promise<Device[]>;
  /** Jobs, most recently updated first. */
  listRecentJobs(limit: number): Promise<JobSummary[]>;
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
