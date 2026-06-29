export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface CommandOutcome {
  deviceId: string;
  ok: boolean;
  error?: string;
}
