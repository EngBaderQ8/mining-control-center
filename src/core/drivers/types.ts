import type { Firmware, Device } from "../model/device";
import type { CommandOutcome } from "../model/result";

export interface HttpRequest {
  host: string;
  port: number;
  method: "GET" | "POST";
  path: string;
  /** Explicit scheme; when unset, inferred (port 443 -> https, else http). */
  scheme?: "http" | "https";
  headers?: Record<string, string>;
  body?: string;
  auth?: { kind: "digest" | "bearer" | "basic"; user?: string; pass?: string; token?: string };
}

export interface HttpResponse {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

export interface Transport {
  tcp4028(host: string, port: number, command: string): Promise<string>;
  http(req: HttpRequest): Promise<HttpResponse>;
}

// ——— Firmware flashing transport ———
// A flash needs a BINARY multipart upload (the firmware image), which the plain
// string-body `http()` can't carry. `FlashTransport` adds that one capability;
// only the agent (main process, real Node http) ever constructs it.

/** One binary part of a multipart/form-data upload. */
export interface UploadFile {
  field: string; // form field name (e.g. "datafile" for Antminer, "image" for Braiins)
  filename: string;
  data: Buffer;
  contentType?: string; // default application/octet-stream
}

export interface HttpUploadRequest {
  host: string;
  port: number;
  path: string;
  scheme?: "http" | "https";
  headers?: Record<string, string>;
  auth?: { kind: "digest" | "bearer" | "basic"; user?: string; pass?: string; token?: string };
  fields?: Record<string, string>; // extra text fields (e.g. keep=1, token=<csrf>)
  files: UploadFile[];
  timeoutMs?: number;
}

export interface FlashTransport extends Transport {
  httpUpload(req: HttpUploadRequest): Promise<HttpResponse>;
}

/** Stages reported as a flash progresses (agent -> server -> dashboard). */
export type FlashPhase =
  | "downloading"
  | "verifying"
  | "matching"
  | "flashing"
  | "rebooting"
  | "confirming";

/** A downloaded, sha256-verified firmware image, ready to push to ONE device. */
export interface FirmwareImage {
  family: Firmware;
  model: string; // expected target model (the agent re-checks against the live device)
  fileName: string; // original filename, e.g. "S19-stock-1.0.tar.gz"
  bytes: Buffer; // raw image (empty for luxos: it pulls its own signed image)
  keepSettings: boolean;
}

/**
 * Result of pushing/triggering the image, BEFORE the version read-back:
 *  - `flashed`  = device accepted it and is rebooting (final success is decided by
 *                 the orchestrator's version read-back, not here);
 *  - `refused`  = device rejected it (bad signature / model / unsupported) and is
 *                 UNCHANGED — a safe no-op, never a brick;
 *  - `failed`   = an error occurred mid-flash (network/timeout) — may be partial.
 */
export interface FlashOutcome {
  ack: "flashed" | "refused" | "failed";
  detail?: string;
}

export type ControlCommand =
  | "restartMining"
  | "stopMining"
  | "startMining"
  | "reboot"
  | "setPool"
  | "setProfile"
  // Not a driver control op — handled in service.sendCommand: reads the device's
  // `stats` on the agent (same LAN as the miner) and returns DeviceHealth JSON in
  // CommandOutcome.data, so a remote viewer can diagnose without direct access.
  | "diagnose";

/** Power profile applied via setProfile (params.mode). */
export type PowerProfile = "normal" | "lowpower" | "highperf";

/** Parameters for setPool. */
export interface PoolParams {
  url: string;
  user: string;
  pass: string;
}

export type CommandParams = Record<string, string>;

export interface DeviceDriver {
  firmware: Firmware;
  execute(
    device: Device,
    command: ControlCommand,
    t: Transport,
    secret?: string,
    params?: CommandParams,
  ): Promise<CommandOutcome>;

  /**
   * Push / trigger a firmware image. OPTIONAL: only families with a safe, known
   * flash path implement it (stock, braiins, luxos). Whatsminer/Vnish leave it
   * undefined so the agent REFUSES the job rather than guessing a byte-push. The
   * orchestrator (flashRunner) handles download, sha256, model-match and the
   * version read-back; the driver only performs the device-specific transfer and
   * reports `flashing`/`rebooting` progress.
   */
  flash?(
    device: Device,
    image: FirmwareImage,
    t: FlashTransport,
    secret?: string,
    onProgress?: (phase: FlashPhase) => void,
  ): Promise<FlashOutcome>;
}
