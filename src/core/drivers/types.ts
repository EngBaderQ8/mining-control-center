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
}
