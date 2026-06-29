import type { Firmware, Device } from "../model/device";
import type { CommandOutcome } from "../model/result";

export interface HttpRequest {
  host: string;
  port: number;
  method: "GET" | "POST";
  path: string;
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
  | "setPool";

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
