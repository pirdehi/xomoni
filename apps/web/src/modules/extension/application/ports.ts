import type {
  ActionAnswer,
  ExtensionState,
  JobMessage,
  OpenMessage,
  PlanMessage,
  ReadAnswer,
  ReadMessage,
  SettingsAnswer,
  SettingsMessage,
  SignInAnswer,
  SignInMessage,
  SignOutAnswer,
} from '@xomoni/bridge';

/** The Xomoni extension in this browser, reached through `externally_connectable` (ADR-0024, ADR-0025). */
export interface ExtensionChannel {
  /** How the extension `extensionId` stands, or null when it doesn't answer (not installed, turned off, too old). */
  hello(extensionId: string): Promise<ExtensionState | null>;
  /** Signs it in with a one-time code; `no_answer` when it doesn't answer. */
  signIn(extensionId: string, message: Omit<SignInMessage, 'type'>): Promise<SignInAnswer>;
  /** Signs it out of Xomoni; null when it doesn't answer. */
  signOut(extensionId: string): Promise<SignOutAnswer | null>;
}

/** The Xomoni extension in this browser, for its actions (ADR-0027): kept apart from the sign-in it doesn't need. */
export interface ActionChannel {
  /** Asks it to pause, cancel or resume a job; `no_answer` when it doesn't answer. */
  job(extensionId: string, message: Omit<JobMessage, 'type'>): Promise<ActionAnswer>;
  /** Asks it to open one of its pages; `no_answer` when it doesn't answer. */
  open(extensionId: string, message: Omit<OpenMessage, 'type'>): Promise<ActionAnswer>;
  /** Reads one of its places' data (ADR-0028); `no_answer` when it doesn't answer. */
  read(extensionId: string, message: DistributiveOmit<ReadMessage, 'type'>): Promise<ReadAnswer>;
  /** Hands it a cleanup plan to review on its Cleanup page (#235); `no_answer` when it doesn't answer. */
  plan(extensionId: string, message: Omit<PlanMessage, 'type'>): Promise<ActionAnswer>;
  /** Changes some of its settings within its own rules (ADR-0029); `no_answer` when it doesn't answer. */
  settings(extensionId: string, message: Omit<SettingsMessage, 'type'>): Promise<SettingsAnswer>;
}

/** `Omit` over each member of a union, keeping it a union. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What this browser keeps for the sync, in the site's own storage. None of it is a secret. */
export interface BrowserMemory {
  /** The extension's id, once an extension page told the site, or null. */
  extensionId(): string | null;
  /** Keeps the extension's id. */
  rememberExtension(extensionId: string): void;
  /** The last time the person signed out on xomoni.com in this browser (epoch ms), 0 when never. */
  websiteSignedOutAt(): number;
  /** Keeps when the person signed out. */
  rememberSignOut(at: number): void;
  /** When this browser first saw the session `sessionId`; keeps `now` for a session it hasn't seen before. */
  sessionSeenAt(sessionId: string, now: number): number;
}

/** The website's account in this browser. */
export interface AccountSession {
  /** The session's id, or null when signed out. Read from this browser's cookie: not a security check. */
  currentSessionId(): Promise<string | null>;
  /** The signed-in account's devices. Row Level Security limits them to the account's own. */
  deviceIds(): Promise<Set<string>>;
  /** A new one-time code for the signed-in account (ADR-0018), or null when none could be made. */
  createCode(): Promise<string | null>;
  /** Ends the session here (the site's own sign-out route). */
  signOut(): Promise<void>;
}

/** Runs one sync at a time across this browser's xomoni.com tabs, so two tabs don't make two codes at once. */
export interface SyncLock {
  /** Runs `task` once no other tab runs one. */
  run<T>(task: () => Promise<T>): Promise<T>;
}
