export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface CommandOutcome {
  deviceId: string;
  ok: boolean;
  error?: string;
  /** Optional JSON payload returned by data-bearing commands (e.g. "diagnose"
   *  returns a DeviceHealth). Rides back through the same command channel. */
  data?: string;
}
