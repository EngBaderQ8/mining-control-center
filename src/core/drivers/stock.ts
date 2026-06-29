import type { DeviceDriver, Transport, ControlCommand } from "./types";
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";

const PATH: Record<ControlCommand, string> = {
  reboot: "/cgi-bin/reboot.cgi",
  restartMining: "/cgi-bin/miner_restart.cgi",
  stopMining: "/cgi-bin/miner_restart.cgi", // stock has no pause; honest restart fallback
  startMining: "/cgi-bin/miner_restart.cgi",
};

export class StockDriver implements DeviceDriver {
  firmware = "stock" as const;

  async execute(
    device: Device,
    command: ControlCommand,
    t: Transport,
    secret?: string,
  ): Promise<CommandOutcome> {
    const [user, pass] = (secret ?? "root:root").split(":");
    try {
      const res = await t.http({
        host: device.host,
        port: device.controlPort,
        method: "GET",
        path: PATH[command],
        auth: { kind: "digest", user, pass },
      });
      return res.status >= 200 && res.status < 300
        ? { deviceId: device.id, ok: true }
        : { deviceId: device.id, ok: false, error: `HTTP ${res.status}` };
    } catch (e) {
      return { deviceId: device.id, ok: false, error: (e as Error).message };
    }
  }
}
