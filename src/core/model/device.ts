export type Firmware = "stock" | "braiins" | "vnish" | "luxos";

export interface Device {
  id: string;
  siteId: string;
  name: string;
  model: string; // e.g. "S19 Pro"
  firmware: Firmware;
  host: string; // Tailscale-routed host/IP
  apiPort: number; // default 4028
  controlPort: number; // 80/443/4028 depending on firmware
}

export interface Site {
  id: string;
  name: string;
}

export type DeviceState = "online" | "offline" | "warning";

import type { DeviceHealth } from "../diagnose/parse";

export interface DeviceStatus {
  deviceId: string;
  state: DeviceState;
  hashrateTHs: number; // current, TH/s
  avgHashrateTHs: number; // average, TH/s
  maxTempC: number; // hottest board/chip
  fanRpm: number; // representative fan
  pool: string;
  worker: string;
  hwErrorRate: number; // 0..1
  uptimeSec: number;
  lastSeen: number; // epoch ms
  health?: DeviceHealth; // per-board/fan diagnostics (computed by the agent's poll)
}
